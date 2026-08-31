package ai.codeforge.android;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.text.TextUtils;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.UUID;

/**
 * Installation identity and opaque vendor push token storage.
 *
 * Tokens never enter logs and are exposed to the WebView only through the
 * narrow CodeForgeAndroid.pushRegistration() bridge so the server can bind the
 * installation to its durable mobile device registry.
 */
final class PushRegistrationStore {
    static final String ACTION_CHANGED = "ai.codeforge.android.PUSH_REGISTRATION_CHANGED";

    private static final String PREFS = "codeforge_android";
    private static final String PREF_DEVICE_ID = "push_device_id";
    private static final String PREF_PUSH_PROVIDER = "push_provider";
    private static final String PREF_PUSH_TOKEN = "push_token";

    private PushRegistrationStore() {}

    static synchronized String getDeviceId(Context context) {
        SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String existing = preferences.getString(PREF_DEVICE_ID, "");
        if (!TextUtils.isEmpty(existing)) {
            return existing;
        }
        String generated = UUID.randomUUID().toString();
        preferences.edit().putString(PREF_DEVICE_ID, generated).apply();
        return generated;
    }

    static synchronized void setPushToken(Context context, String provider, String token) {
        if (TextUtils.isEmpty(provider) || TextUtils.isEmpty(token)) {
            return;
        }
        SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String previousProvider = preferences.getString(PREF_PUSH_PROVIDER, "none");
        String previousToken = preferences.getString(PREF_PUSH_TOKEN, "");
        if (TextUtils.equals(previousProvider, provider) && TextUtils.equals(previousToken, token)) {
            return;
        }
        preferences.edit()
            .putString(PREF_PUSH_PROVIDER, provider)
            .putString(PREF_PUSH_TOKEN, token)
            .apply();
        context.sendBroadcast(
            new Intent(ACTION_CHANGED)
                .setPackage(context.getPackageName())
        );
    }

    static synchronized void clearPushToken(Context context) {
        SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (TextUtils.isEmpty(preferences.getString(PREF_PUSH_TOKEN, ""))) {
            return;
        }
        preferences.edit()
            .putString(PREF_PUSH_PROVIDER, "none")
            .remove(PREF_PUSH_TOKEN)
            .apply();
        context.sendBroadcast(
            new Intent(ACTION_CHANGED)
                .setPackage(context.getPackageName())
        );
    }

    static String toJson(Context context) {
        SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String token = preferences.getString(PREF_PUSH_TOKEN, "");
        String provider = TextUtils.isEmpty(token)
            ? "none"
            : preferences.getString(PREF_PUSH_PROVIDER, "none");

        JSONObject result = new JSONObject();
        try {
            result.put("deviceId", getDeviceId(context));
            result.put("pushProvider", TextUtils.isEmpty(provider) ? "none" : provider);
            result.put("pushToken", TextUtils.isEmpty(token) ? JSONObject.NULL : token);
            result.put("appVersion", BuildConfig.VERSION_NAME);
            String manufacturer = Build.MANUFACTURER == null ? "Android" : Build.MANUFACTURER.trim();
            String model = Build.MODEL == null ? "device" : Build.MODEL.trim();
            result.put("deviceLabel", (manufacturer + " " + model).trim());
        } catch (JSONException ignored) {
            return "{}";
        }
        return result.toString();
    }
}
