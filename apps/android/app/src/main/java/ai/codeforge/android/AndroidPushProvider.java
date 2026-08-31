package ai.codeforge.android;

import android.content.Context;

/**
 * Vendor-neutral Android push token provider.
 *
 * The server contract already understands provider ids such as fcm and huawei;
 * adding another vendor must not change WebSocket or orchestration semantics.
 */
interface AndroidPushProvider {
    String providerId();

    boolean isConfigured();

    void refreshToken(Context context);
}
