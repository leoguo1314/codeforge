package ai.codeforge.android;

import android.content.Context;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.text.TextUtils;
import android.util.Base64;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;

final class AndroidImagePayload {
    private static final int MAX_DECODE_EDGE = 2200;
    private static final int MAX_OUTPUT_EDGE = 1400;
    private static final int MIN_OUTPUT_EDGE = 520;

    private AndroidImagePayload() {}

    static JSONObject fromUri(Context context, Uri uri, int targetJpegBytes) throws Exception {
        Bitmap decoded = decodeSampledBitmap(context, uri);
        if (decoded == null) {
            throw new IOException("Could not decode image.");
        }
        try {
            return fromBitmap(
                decoded,
                normalizeJpegName(displayName(context, uri)),
                targetJpegBytes
            );
        } finally {
            decoded.recycle();
        }
    }

    static JSONObject fromBitmap(Bitmap source, String name, int targetJpegBytes) throws Exception {
        Bitmap working = scaleToMaxEdge(source, MAX_OUTPUT_EDGE);
        boolean ownsWorking = working != source;
        try {
            byte[] jpegBytes = compressBoundedJpeg(working, targetJpegBytes);
            JSONObject image = new JSONObject();
            image.put("name", normalizeJpegName(name));
            image.put("mimeType", "image/jpeg");
            image.put(
                "dataUrl",
                "data:image/jpeg;base64," + Base64.encodeToString(jpegBytes, Base64.NO_WRAP)
            );
            return image;
        } finally {
            if (ownsWorking) {
                working.recycle();
            }
        }
    }

    private static Bitmap decodeSampledBitmap(Context context, Uri uri) throws IOException {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        try (InputStream input = context.getContentResolver().openInputStream(uri)) {
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
        try (InputStream input = context.getContentResolver().openInputStream(uri)) {
            if (input == null) throw new IOException("Shared image is unavailable.");
            return BitmapFactory.decodeStream(input, null, options);
        }
    }

    private static Bitmap scaleToMaxEdge(Bitmap bitmap, int maxEdge) {
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

    private static byte[] compressBoundedJpeg(Bitmap source, int targetJpegBytes) throws IOException {
        Bitmap working = source;
        boolean ownsWorking = false;
        try {
            for (int resizePass = 0; resizePass < 6; resizePass += 1) {
                for (int quality = 84; quality >= 48; quality -= 8) {
                    ByteArrayOutputStream output = new ByteArrayOutputStream();
                    if (!working.compress(Bitmap.CompressFormat.JPEG, quality, output)) {
                        throw new IOException("Could not compress image.");
                    }
                    byte[] bytes = output.toByteArray();
                    if (bytes.length <= targetJpegBytes) {
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
            throw new IOException("Image could not be reduced to a safe transfer size.");
        } finally {
            if (ownsWorking && working != source) {
                working.recycle();
            }
        }
    }

    private static String displayName(Context context, Uri uri) {
        try (Cursor cursor = context.getContentResolver().query(
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

    private static String normalizeJpegName(String name) {
        String safeName = TextUtils.isEmpty(name) ? "image" : name.trim();
        int dot = safeName.lastIndexOf('.');
        if (dot > 0) {
            safeName = safeName.substring(0, dot);
        }
        return safeName + ".jpg";
    }
}
