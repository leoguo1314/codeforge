package ai.codeforge.android;

import android.text.TextUtils;

import com.huawei.hms.push.HmsMessageService;
import com.huawei.hms.push.RemoteMessage;

import org.json.JSONException;
import org.json.JSONObject;

/** Receives CodeForge Huawei Push Kit data messages and token rotation callbacks. */
public final class CodeForgeHuaweiMessagingService extends HmsMessageService {
    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        if (!TextUtils.isEmpty(token)) {
            PushRegistrationStore.setPushToken(getApplicationContext(), "huawei", token);
        }
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        super.onMessageReceived(message);
        if (AppRuntimeState.hasLiveWebSocket()) {
            return;
        }

        String kind = "info";
        String title = "CodeForge";
        String body = "CodeForge notification";
        String raw = message == null ? null : message.getData();
        if (!TextUtils.isEmpty(raw)) {
            try {
                JSONObject data = new JSONObject(raw);
                kind = safeKind(data.optString("kind", "info"));
                title = nonEmpty(data.optString("title", ""), "CodeForge");
                body = nonEmpty(data.optString("body", ""), kind);
            } catch (JSONException ignored) {
                // Keep safe fallbacks for malformed vendor payloads.
            }
        }
        AgentNotificationManager.post(getApplicationContext(), kind, title, body);
    }

    private static String safeKind(String value) {
        if ("approval".equals(value)
            || "input".equals(value)
            || "complete".equals(value)
            || "info".equals(value)) {
            return value;
        }
        return "info";
    }

    private static String nonEmpty(String value, String fallback) {
        return TextUtils.isEmpty(value) ? fallback : value;
    }
}
