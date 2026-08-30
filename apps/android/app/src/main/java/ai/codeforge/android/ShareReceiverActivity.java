package ai.codeforge.android;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.text.TextUtils;
import android.util.Base64;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;

/**
 * Receives Android image shares and converts them into a bounded payload that
 * MainActivity can deliver to the existing CodeForge Web composer bridge.
 *
 * The payload is deliberately kept small because Intent extras and WebView
 * evaluateJavascript calls ultimately cross Binder boundaries. Images are
 * resized and JPEG-compressed before being forwarded; nothing is auto-sent.
 */
public final class ShareReceiverActivity extends Activity {
    private static final String SHARE_PREFIX = "__CODEFORGE_ANDROID_SHARE_V1__";
    private static final int MAX_DECODE_EDGE = 2200;
    private static final int MAX_OUTPUT_EDGE = 1400;
    private static final int TARGET_JPEG_BYTES = 240 * 1024;
    private static final int MIN_OUTPUT_EDGE = 520;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Intent source = getIntent();
        Uri stream = sharedStreamFromIntent(source);
        if (stream == null) {
            Toast.makeText(this, "CodeForge could not read the shared image.", Toast.LENGTH_SHORT).show();
            finish();
            return;
        }

        try {
            String payload = buildImagePayload(source, stream);
            Intent target = new Intent(this, MainActivity.class)
                .setAction(Intent.ACTION_SEND)
                .setType("text/plain")
                .putExtra(Intent.EXTRA_TEXT, SHARE_PREFIX + payload)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(target);
        } catch (Exception error) {
            Toast.makeText(
                this,
                "CodeForge could not prepare the shared image.",
                Toast.LENGTH_SHORT
            ).show();
        } finally {
            finish();
        }
    }

    private String buildImagePayload(Intent source, Uri uri) throws Exception {
        Bitmap decoded = decodeSampledBitmap(uri);
        if (decoded == null) {
            throw new IOException("Could not decode image.");
        }

        Bitmap working = scaleToMaxEdge(decoded, MAX_OUTPUT_EDGE);
        if (working != decoded) {
            decoded.recycle();
        }

        byte[] jpegBytes;
        try {
            jpegBytes = compressBoundedJpeg(working);
        } finally {
            working.recycle();
        }

        String originalName = displayName(uri);
        String imageName = normalizeJpegName(originalName);
        String dataUrl = "data:image/jpeg;base64," + Base64.encodeToString(jpegBytes, Base64.NO_WRAP);
        CharSequence sharedText = source.getCharSequenceExtra(Intent.EXTRA_TEXT);

        JSONObject json = new JSONObject();
        json.put("kind", "image");
        json.put("name", imageName);
        json.put("mimeType", "image/jpeg");
        json.put("dataUrl", dataUrl);
        if (sharedText != null && !TextUtils.isEmpty(sharedText.toString().trim())) {
            json.put("text", sharedText.toString().trim());
        }
        return json.toString();
    }

    private Bitmap decodeSampledBitmap(Uri uri) throws IOException {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        try (InputStream input = getContentResolver().openInputStream(uri)) {
            if (input == null) throw new IOException("Shared image is unavailable.");
            BitmapFactory.decodeStream(input, null, bounds);
        }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
            throw new IOException("Shared image dimensions are unavailable.");
        }

        int sampleSize = 1;
        while (
            bounds.outWidth / sampleSize > MAX_DECODE_EDGE ||
            bounds.outHeight / sampleSize > MAX_DECODE_EDGE
        ) {
            sampleSize *= 2;
        }

        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sampleSize;
        options.inPreferredConfig = Bitmap.Config.ARGB_8888;
        try (InputStream input = getContentResolver().openInputStream(uri)) {
            if (input == null) throw new IOException("Shared image is unavailable.");
            return BitmapFactory.decodeStream(input, null, options);
        }
    }

    private Bitmap scaleToMaxEdge(Bitmap bitmap, int maxEdge) {
        int width = bitmap.getWidth();
        int height = bitmap.getHeight();
        int currentMax = Math.max(width, height);
        if (currentMax <= maxEdge) {
            return bitmap;
        }

        float scale = maxEdge / (float) currentMax;
        int nextWidth = Math.max(1, Math.round(width * scale));
        int nextHeight = Math.max(1, Math.round(height * scale));
        return Bitmap.createScaledBitmap(bitmap, nextWidth, nextHeight, true);
    }

    private byte[] compressBoundedJpeg(Bitmap source) throws IOException {
        Bitmap working = source;
        boolean ownsWorking = false;
        try {
            for (int resizePass = 0; resizePass < 6; resizePass += 1) {
                for (int quality = 84; quality >= 52; quality -= 8) {
                    ByteArrayOutputStream output = new ByteArrayOutputStream();
                    if (!working.compress(Bitmap.CompressFormat.JPEG, quality, output)) {
                        throw new IOException("Could not compress shared image.");
                    }
                    byte[] bytes = output.toByteArray();
                    if (bytes.length <= TARGET_JPEG_BYTES) {
                        return bytes;
                    }
                }

                int maxEdge = Math.max(working.getWidth(), working.getHeight());
                if (maxEdge <= MIN_OUTPUT_EDGE) {
                    break;
                }
                int nextMaxEdge = Math.max(MIN_OUTPUT_EDGE, Math.round(maxEdge * 0.82f));
                Bitmap smaller = scaleToMaxEdge(working, nextMaxEdge);
                if (smaller == working) {
                    break;
                }
                if (ownsWorking) {
                    working.recycle();
                }
                working = smaller;
                ownsWorking = true;
            }
            throw new IOException("Shared image could not be reduced to a safe transfer size.");
        } finally {
            if (ownsWorking && working != source) {
                working.recycle();
            }
        }
    }

    private String displayName(Uri uri) {
        try (Cursor cursor = getContentResolver().query(
            uri,
            new String[]{OpenableColumns.DISPLAY_NAME},
            null,
            null,
            null
        )) {
            if (cursor != null && cursor.moveToFirst()) {
                int column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (column >= 0) {
                    String value = cursor.getString(column);
                    if (!TextUtils.isEmpty(value)) {
                        return value;
                    }
                }
            }
        } catch (RuntimeException ignored) {
            // Some content providers do not expose OpenableColumns metadata.
        }
        return "shared-image.jpg";
    }

    private String normalizeJpegName(String name) {
        String safeName = TextUtils.isEmpty(name) ? "shared-image" : name.trim();
        int dot = safeName.lastIndexOf('.');
        if (dot > 0) {
            safeName = safeName.substring(0, dot);
        }
        return safeName + ".jpg";
    }

    @SuppressWarnings("deprecation")
    private Uri sharedStreamFromIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) {
            return null;
        }
        if (Build.VERSION.SDK_INT >= 33) {
            return intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
        }
        return intent.getParcelableExtra(Intent.EXTRA_STREAM);
    }
}
