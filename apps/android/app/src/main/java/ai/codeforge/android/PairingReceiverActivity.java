package ai.codeforge.android;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.TextUtils;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * External deep-link boundary for Android pairing.
 *
 * v0.9 QR links contain only a short-lived, single-use pairing code. This
 * activity redeems that code over HTTPS/HTTP(debug only), receives a mobile
 * session token, then explicitly launches MainActivity with an internal legacy
 * token-form deep link. MainActivity therefore never needs to own unauthenticated
 * pairing network logic and remains backward-compatible with older token links.
 */
public final class PairingReceiverActivity extends Activity {
    private static final int TIMEOUT_MS = 10_000;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        handleIntent(getIntent());
    }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }

    private void handleIntent(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (data == null
            || !"codeforge".equalsIgnoreCase(data.getScheme())
            || !"connect".equalsIgnoreCase(data.getHost())) {
            finish();
            return;
        }

        String server = normalizeServerUrl(data.getQueryParameter("server"));
        if (server == null) {
            fail("Invalid CodeForge server URL.");
            return;
        }

        String pairCode = trimToNull(data.getQueryParameter("pair"));
        if (pairCode != null) {
            redeem(server, pairCode);
            return;
        }

        // Backward compatibility for v0.4-v0.8 token-bearing links. The v0.9
        // desktop UI no longer creates these links.
        String token = trimToNull(data.getQueryParameter("token"));
        if (token != null) {
            launchMain(server, token);
            return;
        }

        fail("Pairing link is missing its one-time code.");
    }

    private void redeem(String server, String pairCode) {
        String deviceId = PushRegistrationStore.getDeviceId(getApplicationContext());
        String manufacturer = Build.MANUFACTURER == null ? "Android" : Build.MANUFACTURER.trim();
        String model = Build.MODEL == null ? "device" : Build.MODEL.trim();
        String deviceLabel = (manufacturer + " " + model).trim();

        executor.execute(() -> {
            HttpURLConnection connection = null;
            try {
                URL endpoint = new URL(new URL(server), "api/mobile/pair/redeem");
                connection = (HttpURLConnection) endpoint.openConnection();
                connection.setConnectTimeout(TIMEOUT_MS);
                connection.setReadTimeout(TIMEOUT_MS);
                connection.setRequestMethod("POST");
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                connection.setRequestProperty("Accept", "application/json");
                connection.setDoOutput(true);

                JSONObject request = new JSONObject();
                request.put("code", pairCode);
                request.put("deviceId", deviceId);
                request.put("deviceLabel", TextUtils.isEmpty(deviceLabel) ? JSONObject.NULL : deviceLabel);
                byte[] bytes = request.toString().getBytes(StandardCharsets.UTF_8);
                connection.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(bytes);
                }

                int status = connection.getResponseCode();
                InputStream stream = status >= 200 && status < 300
                    ? connection.getInputStream()
                    : connection.getErrorStream();
                String body = readBody(stream);
                if (status < 200 || status >= 300) {
                    throw new IllegalStateException("Pairing code was rejected.");
                }

                JSONObject response = new JSONObject(body);
                String sessionToken = trimToNull(response.optString("sessionToken", null));
                if (sessionToken == null) {
                    throw new IllegalStateException("Pairing response did not include a session token.");
                }

                runOnUiThread(() -> launchMain(server, sessionToken));
            } catch (Exception ignored) {
                runOnUiThread(() -> fail("Pairing failed. Generate a new QR code and try again."));
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    private static String readBody(InputStream stream) throws Exception {
        if (stream == null) return "";
        StringBuilder builder = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
            new InputStreamReader(stream, StandardCharsets.UTF_8)
        )) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (builder.length() > 64 * 1024) {
                    throw new IllegalStateException("Pairing response is too large.");
                }
                builder.append(line);
            }
        }
        return builder.toString();
    }

    private void launchMain(String server, String sessionToken) {
        Uri internalData = new Uri.Builder()
            .scheme("codeforge")
            .authority("connect")
            .appendQueryParameter("server", server)
            .appendQueryParameter("token", sessionToken)
            .build();
        Intent launch = new Intent(this, MainActivity.class)
            .setAction(Intent.ACTION_VIEW)
            .setData(internalData)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(launch);
        finish();
    }

    private void fail(String message) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
        finish();
    }

    private static String normalizeServerUrl(String raw) {
        String value = trimToNull(raw);
        if (value == null) return null;
        try {
            URL parsed = new URL(value);
            String scheme = parsed.getProtocol();
            if (!"https".equalsIgnoreCase(scheme)
                && !(BuildConfig.DEBUG && "http".equalsIgnoreCase(scheme))) {
                return null;
            }
            if (TextUtils.isEmpty(parsed.getHost())) return null;
            String normalized = parsed.toString();
            return normalized.endsWith("/") ? normalized : normalized + "/";
        } catch (Exception ignored) {
            return null;
        }
    }

    private static String trimToNull(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
