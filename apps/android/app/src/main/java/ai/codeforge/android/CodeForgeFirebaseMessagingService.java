package ai.codeforge.android;

import android.text.TextUtils;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Receives data-only CodeForge FCM messages and token rotation callbacks.
 *
 * The gateway should preserve the canonical mobile.notification fields in the
 * FCM data payload. If a live WebSocket is still connected, the service skips
 * posting so the existing real-time path remains the single renderer.
 */
public final class CodeForgeFirebaseMessagingService extends FirebaseMessagingService {
    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        if (!TextUtils.isEmpty(token)) {
            PushRegistrationStore.setPushToken(getApplicationContext(), "fcm", token);
        }
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        super.onMessageReceived(message);
        if (AppRuntimeState.hasLiveWebSocket()) {
            return;
        }

        Map<String, String> data = message.getData();
        RemoteMessage.Notification vendorNotification = message.getNotification();
        String kind = safeKind(data.get("kind"));
        String title = nonEmpty(
            data.get("title"),
            vendorNotification == null ? null : vendorNotification.getTitle(),
            "CodeForge"
        );
        String body = nonEmpty(
            data.get("body"),
            vendorNotification == null ? null : vendorNotification.getBody(),
            kind
        );
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

    private static String nonEmpty(String first, String second, String fallback) {
        if (!TextUtils.isEmpty(first)) return first;
        if (!TextUtils.isEmpty(second)) return second;
        return fallback;
    }
}
