package ai.codeforge.android;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.text.TextUtils;

/** Common notification renderer for WebSocket-live and vendor-push delivery. */
final class AgentNotificationManager {
    static final String CHANNEL_ID = "codeforge_agent_events";

    private AgentNotificationManager() {}

    static void ensureChannel(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "CodeForge agent events",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("Approvals, user-input requests, and completed agent turns.");
        manager.createNotificationChannel(channel);
    }

    static void post(Context context, String kind, String title, String body) {
        if (Build.VERSION.SDK_INT >= 33 &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }

        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }
        ensureChannel(context);

        Intent openIntent = new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int requestCode = (int) (System.currentTimeMillis() & 0x7fffffff);
        PendingIntent contentIntent = PendingIntent.getActivity(
            context,
            requestCode,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String safeTitle = TextUtils.isEmpty(title) ? "CodeForge" : title;
        String safeBody = TextUtils.isEmpty(body) ? kind : body;
        Notification notification = new Notification.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_more)
            .setContentTitle(safeTitle)
            .setContentText(safeBody)
            .setStyle(new Notification.BigTextStyle().bigText(safeBody))
            .setContentIntent(contentIntent)
            .setAutoCancel(true)
            .build();
        manager.notify(requestCode, notification);
    }
}
