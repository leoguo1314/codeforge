package ai.codeforge.android;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.TextUtils;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Receives Android image shares and converts them into bounded payloads that
 * MainActivity can deliver to the existing CodeForge Web composer bridge.
 *
 * Nothing is auto-sent. Multi-image shares are capped so the combined Intent
 * payload remains safely below practical Binder transaction limits.
 */
public final class ShareReceiverActivity extends Activity {
    private static final String SHARE_PREFIX = "__CODEFORGE_ANDROID_SHARE_V1__";
    private static final int MAX_SHARED_IMAGES = 4;
    private static final int SINGLE_IMAGE_TARGET_BYTES = 220 * 1024;
    private static final int MULTI_IMAGE_TARGET_BYTES = 96 * 1024;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Intent source = getIntent();
        List<Uri> streams = sharedStreamsFromIntent(source);
        if (streams.isEmpty()) {
            Toast.makeText(this, "CodeForge could not read the shared image.", Toast.LENGTH_SHORT).show();
            finish();
            return;
        }
        if (streams.size() > MAX_SHARED_IMAGES) {
            Toast.makeText(
                this,
                "CodeForge supports up to " + MAX_SHARED_IMAGES + " images per share.",
                Toast.LENGTH_LONG
            ).show();
            finish();
            return;
        }

        try {
            String payload = buildImagePayload(source, streams);
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

    private String buildImagePayload(Intent source, List<Uri> streams) throws Exception {
        CharSequence sharedText = source.getCharSequenceExtra(Intent.EXTRA_TEXT);
        String caption = sharedText == null ? "" : sharedText.toString().trim();

        if (streams.size() == 1) {
            JSONObject image = AndroidImagePayload.fromUri(
                this,
                streams.get(0),
                SINGLE_IMAGE_TARGET_BYTES
            );
            image.put("kind", "image");
            if (!TextUtils.isEmpty(caption)) {
                image.put("text", caption);
            }
            return image.toString();
        }

        JSONArray images = new JSONArray();
        for (Uri stream : streams) {
            images.put(AndroidImagePayload.fromUri(this, stream, MULTI_IMAGE_TARGET_BYTES));
        }

        JSONObject payload = new JSONObject();
        payload.put("kind", "images");
        payload.put("images", images);
        if (!TextUtils.isEmpty(caption)) {
            payload.put("text", caption);
        }
        return payload.toString();
    }

    @SuppressWarnings("deprecation")
    private List<Uri> sharedStreamsFromIntent(Intent intent) {
        List<Uri> result = new ArrayList<>();
        if (intent == null) {
            return result;
        }

        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            Uri stream;
            if (Build.VERSION.SDK_INT >= 33) {
                stream = intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
            } else {
                stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            }
            if (stream != null) result.add(stream);
            return result;
        }

        if (!Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())) {
            return result;
        }

        ArrayList<Uri> streams;
        if (Build.VERSION.SDK_INT >= 33) {
            streams = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class);
        } else {
            streams = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
        }
        if (streams != null) {
            result.addAll(streams);
        }
        return result;
    }
}
