package ai.codeforge.android;

import android.content.Context;
import android.text.TextUtils;

import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.messaging.FirebaseMessaging;

/** First production native push provider for CodeForge Android. */
final class FcmPushProvider implements AndroidPushProvider {
    @Override
    public String providerId() {
        return "fcm";
    }

    @Override
    public boolean isConfigured() {
        return !TextUtils.isEmpty(BuildConfig.FIREBASE_APPLICATION_ID)
            && !TextUtils.isEmpty(BuildConfig.FIREBASE_PROJECT_ID)
            && !TextUtils.isEmpty(BuildConfig.FIREBASE_API_KEY)
            && !TextUtils.isEmpty(BuildConfig.FIREBASE_SENDER_ID);
    }

    @Override
    public void refreshToken(Context context) {
        Context appContext = context.getApplicationContext();
        if (!isConfigured()) {
            PushRegistrationStore.clearPushTokenIfProvider(appContext, providerId());
            return;
        }

        try {
            ensureFirebaseInitialized(appContext);
            FirebaseMessaging.getInstance().setAutoInitEnabled(true);
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
                if (!task.isSuccessful()) {
                    return;
                }
                String token = task.getResult();
                if (!TextUtils.isEmpty(token)) {
                    PushRegistrationStore.setPushToken(appContext, providerId(), token);
                }
            });
        } catch (RuntimeException ignored) {
            // FCM availability/configuration failure must never block the coding workspace.
            // Keep an existing token so a transient Google Play services failure does not
            // unnecessarily unregister a still-valid installation.
        }
    }

    private void ensureFirebaseInitialized(Context context) {
        try {
            FirebaseApp.getInstance();
            return;
        } catch (IllegalStateException ignored) {
            // No default app exists because CodeForge deliberately does not require a
            // repository-local google-services.json. Initialize from build-time values.
        }

        FirebaseOptions options = new FirebaseOptions.Builder()
            .setApplicationId(BuildConfig.FIREBASE_APPLICATION_ID)
            .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
            .setApiKey(BuildConfig.FIREBASE_API_KEY)
            .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
            .build();
        FirebaseApp.initializeApp(context, options);
    }
}
