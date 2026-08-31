package ai.codeforge.android;

import android.content.Context;
import android.text.TextUtils;

import com.huawei.hms.aaid.HmsInstanceId;
import com.huawei.hms.common.ApiException;
import com.huawei.hms.push.HmsMessaging;

/** Huawei HMS Core Push Kit provider. */
final class HuaweiPushProvider implements AndroidPushProvider {
    @Override
    public String providerId() {
        return "huawei";
    }

    @Override
    public boolean isConfigured() {
        return !TextUtils.isEmpty(BuildConfig.HUAWEI_APP_ID);
    }

    @Override
    public void refreshToken(Context context) {
        Context appContext = context.getApplicationContext();
        if (!isConfigured()) {
            PushRegistrationStore.clearPushTokenIfProvider(appContext, providerId());
            return;
        }

        Thread worker = new Thread(() -> {
            try {
                String token = HmsInstanceId.getInstance(appContext).getToken(
                    BuildConfig.HUAWEI_APP_ID,
                    HmsMessaging.DEFAULT_TOKEN_SCOPE
                );
                if (!TextUtils.isEmpty(token)) {
                    PushRegistrationStore.setPushToken(appContext, providerId(), token);
                }
            } catch (ApiException | RuntimeException ignored) {
                // HMS availability or project configuration errors must never block
                // the coding workspace. Keep an existing token on transient failure.
            }
        }, "codeforge-huawei-push-token");
        worker.setDaemon(true);
        worker.start();
    }
}
