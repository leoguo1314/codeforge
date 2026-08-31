package ai.codeforge.android;

import android.content.Context;
import android.os.Build;

import java.util.Locale;

/** Selects one native vendor push implementation for the current installation. */
final class PushProviderCoordinator {
    private final AndroidPushProvider provider;

    PushProviderCoordinator() {
        AndroidPushProvider fcm = new FcmPushProvider();
        AndroidPushProvider huawei = new HuaweiPushProvider();
        String manufacturer = Build.MANUFACTURER == null
            ? ""
            : Build.MANUFACTURER.toLowerCase(Locale.ROOT);
        boolean prefersHuawei = manufacturer.contains("huawei");

        if (prefersHuawei && huawei.isConfigured()) {
            provider = huawei;
        } else if (fcm.isConfigured()) {
            provider = fcm;
        } else if (huawei.isConfigured()) {
            provider = huawei;
        } else {
            provider = fcm;
        }
    }

    void refreshToken(Context context) {
        provider.refreshToken(context);
    }

    boolean isConfigured() {
        return provider.isConfigured();
    }
}
