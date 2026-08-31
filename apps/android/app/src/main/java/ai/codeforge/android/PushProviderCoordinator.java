package ai.codeforge.android;

import android.content.Context;

/**
 * Selects the native vendor push implementation without leaking vendor SDK
 * details into MainActivity or the JavaScript bridge.
 *
 * Huawei Push Kit will plug in here as another AndroidPushProvider. The shared
 * server/mobile contracts already reserve the `huawei` provider id.
 */
final class PushProviderCoordinator {
    private final AndroidPushProvider provider;

    PushProviderCoordinator() {
        provider = new FcmPushProvider();
    }

    void refreshToken(Context context) {
        provider.refreshToken(context);
    }

    boolean isConfigured() {
        return provider.isConfigured();
    }
}
