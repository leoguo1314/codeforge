package ai.codeforge.android;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.text.InputType;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.util.ArrayDeque;
import java.util.Locale;

/**
 * Android workspace client for CodeForge.
 *
 * Agent runtimes, Git, Terminal, Skills, persistence, and orchestration stay on
 * the remote CodeForge Server. Android supplies the mobile shell, secure remote
 * connection profile, native shares, pairing deep links, image selection,
 * quick camera capture, and background notifications.
 */
public final class MainActivity extends Activity {
    private static final String PREFS = "codeforge_android";
    private static final String PREF_SERVER_URL = "server_url";
    private static final String PREF_AUTH_TOKEN = "auth_token";
    private static final String NOTIFICATION_CHANNEL_ID = "codeforge_agent_events";
    private static final String SHARE_PREFIX = "__CODEFORGE_ANDROID_SHARE_V1__";

    private static final int FILE_CHOOSER_REQUEST = 7001;
    private static final int NOTIFICATION_PERMISSION_REQUEST = 7002;
    private static final int CAMERA_CAPTURE_REQUEST = 7003;
    private static final int CAMERA_TARGET_BYTES = 220 * 1024;

    private static final int MENU_CAMERA = 1;
    private static final int MENU_RELOAD = 2;
    private static final int MENU_CHANGE_CONNECTION = 3;
    private static final int MENU_DISCONNECT = 4;

    private SharedPreferences preferences;
    private FrameLayout contentContainer;
    private TextView serverLabel;
    private WebView webView;
    private ValueCallback<Uri[]> pendingFileChooser;
    private String currentServerUrl;
    private String currentAuthToken;
    private final ArrayDeque<String> pendingShares = new ArrayDeque<>();
    private boolean foreground;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        createNotificationChannel();
        requestNotificationPermissionIfNeeded();
        setContentView(createRootView());

        enqueueIncomingShare(getIntent());
        PairingRequest pairingRequest = pairingRequestFromIntent(getIntent());
        if (pairingRequest != null) {
            connect(pairingRequest.serverUrl, pairingRequest.authToken, true);
            return;
        }

        String savedServerUrl = preferences.getString(PREF_SERVER_URL, "");
        String savedAuthToken = preferences.getString(PREF_AUTH_TOKEN, "");
        if (!TextUtils.isEmpty(savedServerUrl)) {
            connect(savedServerUrl, savedAuthToken == null ? "" : savedAuthToken, false);
        } else {
            showConnectionForm(null);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);

        PairingRequest pairingRequest = pairingRequestFromIntent(intent);
        if (pairingRequest != null) {
            connect(pairingRequest.serverUrl, pairingRequest.authToken, true);
            return;
        }

        if (enqueueIncomingShare(intent)) {
            dispatchPendingShares();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        foreground = true;
    }

    @Override
    protected void onPause() {
        foreground = false;
        super.onPause();
    }

    private View createRootView() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(17, 19, 24));

        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setOrientation(LinearLayout.HORIZONTAL);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(12), 0, dp(4), 0);
        toolbar.setBackgroundColor(Color.rgb(17, 19, 24));
        root.addView(toolbar, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(40)
        ));

        serverLabel = new TextView(this);
        serverLabel.setText("CodeForge");
        serverLabel.setTextColor(Color.rgb(224, 227, 234));
        serverLabel.setSingleLine(true);
        serverLabel.setEllipsize(TextUtils.TruncateAt.END);
        serverLabel.setTextSize(13);
        toolbar.addView(serverLabel, new LinearLayout.LayoutParams(
            0,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            1f
        ));

        Button menuButton = new Button(this);
        menuButton.setText("⋮");
        menuButton.setTextSize(22);
        menuButton.setTextColor(Color.WHITE);
        menuButton.setBackgroundColor(Color.TRANSPARENT);
        menuButton.setMinWidth(0);
        menuButton.setMinimumWidth(0);
        menuButton.setPadding(dp(12), 0, dp(12), 0);
        menuButton.setOnClickListener(this::showServerMenu);
        toolbar.addView(menuButton, new LinearLayout.LayoutParams(
            dp(48),
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        contentContainer = new FrameLayout(this);
        root.addView(contentContainer, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            0,
            1f
        ));
        return root;
    }

    private void showServerMenu(View anchor) {
        PopupMenu menu = new PopupMenu(this, anchor);
        menu.getMenu().add(0, MENU_CAMERA, 0, "Camera → Composer");
        menu.getMenu().add(0, MENU_RELOAD, 1, "Reload");
        menu.getMenu().add(0, MENU_CHANGE_CONNECTION, 2, "Connection");
        menu.getMenu().add(0, MENU_DISCONNECT, 3, "Disconnect");
        menu.setOnMenuItemClickListener(item -> {
            if (item.getItemId() == MENU_CAMERA) {
                launchCameraCapture();
                return true;
            }
            if (item.getItemId() == MENU_RELOAD) {
                if (webView != null) {
                    webView.reload();
                }
                return true;
            }
            if (item.getItemId() == MENU_CHANGE_CONNECTION) {
                showConnectionForm(null);
                return true;
            }
            if (item.getItemId() == MENU_DISCONNECT) {
                preferences.edit().remove(PREF_SERVER_URL).remove(PREF_AUTH_TOKEN).apply();
                currentServerUrl = null;
                currentAuthToken = null;
                showConnectionForm(null);
                return true;
            }
            return false;
        });
        menu.show();
    }

    private void launchCameraCapture() {
        if (webView == null || webView.getParent() == null) {
            Toast.makeText(this, "Connect to CodeForge before taking a photo.", Toast.LENGTH_SHORT).show();
            return;
        }
        try {
            startActivityForResult(
                new Intent(MediaStore.ACTION_IMAGE_CAPTURE),
                CAMERA_CAPTURE_REQUEST
            );
        } catch (ActivityNotFoundException error) {
            Toast.makeText(this, "No camera app is available.", Toast.LENGTH_SHORT).show();
        }
    }

    private void showConnectionForm(String errorMessage) {
        if (webView != null) {
            webView.stopLoading();
        }
        contentContainer.removeAllViews();
        serverLabel.setText("CodeForge · not connected");

        ScrollView scrollView = new ScrollView(this);
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(24), dp(28), dp(24), dp(28));
        scrollView.addView(form, new ScrollView.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        TextView title = new TextView(this);
        title.setText(getString(R.string.connection_title));
        title.setTextColor(Color.WHITE);
        title.setTextSize(24);
        form.addView(title);

        TextView description = new TextView(this);
        description.setText(getString(R.string.connection_description));
        description.setTextColor(Color.rgb(185, 190, 200));
        description.setTextSize(14);
        LinearLayout.LayoutParams descriptionParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        descriptionParams.topMargin = dp(10);
        form.addView(description, descriptionParams);

        if (!TextUtils.isEmpty(errorMessage)) {
            TextView error = new TextView(this);
            error.setText(errorMessage);
            error.setTextColor(Color.rgb(255, 130, 130));
            LinearLayout.LayoutParams errorParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            );
            errorParams.topMargin = dp(14);
            form.addView(error, errorParams);
        }

        EditText serverUrl = new EditText(this);
        serverUrl.setHint(getString(R.string.server_url_hint));
        serverUrl.setSingleLine(true);
        serverUrl.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        serverUrl.setText(currentServerUrl != null
            ? currentServerUrl
            : preferences.getString(PREF_SERVER_URL, ""));
        LinearLayout.LayoutParams urlParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        urlParams.topMargin = dp(24);
        form.addView(serverUrl, urlParams);

        EditText authToken = new EditText(this);
        authToken.setHint(getString(R.string.auth_token_hint));
        authToken.setSingleLine(true);
        authToken.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        authToken.setText(currentAuthToken != null
            ? currentAuthToken
            : preferences.getString(PREF_AUTH_TOKEN, ""));
        LinearLayout.LayoutParams tokenParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        tokenParams.topMargin = dp(12);
        form.addView(authToken, tokenParams);

        Button connectButton = new Button(this);
        connectButton.setText(getString(R.string.connect));
        connectButton.setOnClickListener(v -> connect(
            serverUrl.getText().toString(),
            authToken.getText().toString(),
            true
        ));
        LinearLayout.LayoutParams connectParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        connectParams.topMargin = dp(18);
        form.addView(connectButton, connectParams);

        TextView securityHint = new TextView(this);
        securityHint.setText(getString(R.string.connection_security_hint));
        securityHint.setTextColor(Color.rgb(140, 147, 160));
        securityHint.setTextSize(12);
        LinearLayout.LayoutParams hintParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        hintParams.topMargin = dp(14);
        form.addView(securityHint, hintParams);

        contentContainer.addView(scrollView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));
    }

    private void connect(String rawServerUrl, String authToken, boolean persist) {
        final String normalizedServerUrl;
        try {
            normalizedServerUrl = normalizeServerUrl(rawServerUrl);
        } catch (IllegalArgumentException error) {
            showConnectionForm(error.getMessage());
            return;
        }

        String normalizedToken = authToken == null ? "" : authToken.trim();
        currentServerUrl = normalizedServerUrl;
        currentAuthToken = normalizedToken;
        if (persist) {
            preferences.edit()
                .putString(PREF_SERVER_URL, normalizedServerUrl)
                .putString(PREF_AUTH_TOKEN, normalizedToken)
                .apply();
        }

        Uri serverUri = Uri.parse(normalizedServerUrl);
        String authority = serverUri.getAuthority();
        serverLabel.setText(authority == null ? "CodeForge" : "CodeForge · " + authority);
        showWebView(buildLaunchUri(normalizedServerUrl, normalizedToken));
    }

    private String normalizeServerUrl(String rawServerUrl) {
        String candidate = rawServerUrl == null ? "" : rawServerUrl.trim();
        if (candidate.isEmpty()) {
            throw new IllegalArgumentException("Server URL is required.");
        }
        if (!candidate.matches("^[A-Za-z][A-Za-z0-9+.-]*://.*$")) {
            candidate = "https://" + candidate;
        }

        Uri uri = Uri.parse(candidate);
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!scheme.equals("https") && !scheme.equals("http")) {
            throw new IllegalArgumentException("Server URL must use HTTPS or HTTP.");
        }
        if (scheme.equals("http") && !BuildConfig.DEBUG) {
            throw new IllegalArgumentException("Release builds require HTTPS.");
        }
        if (TextUtils.isEmpty(uri.getHost())) {
            throw new IllegalArgumentException("Server URL must include a valid host.");
        }

        String path = uri.getEncodedPath();
        if (TextUtils.isEmpty(path)) {
            path = "/";
        }
        return new Uri.Builder()
            .scheme(scheme)
            .encodedAuthority(uri.getEncodedAuthority())
            .encodedPath(path)
            .build()
            .toString();
    }

    private Uri buildLaunchUri(String serverUrl, String authToken) {
        Uri source = Uri.parse(serverUrl);
        Uri.Builder builder = new Uri.Builder()
            .scheme(source.getScheme())
            .encodedAuthority(source.getEncodedAuthority())
            .encodedPath(source.getEncodedPath());
        if (!TextUtils.isEmpty(authToken)) {
            builder.appendQueryParameter("token", authToken);
        }
        return builder.build();
    }

    private void showWebView(Uri launchUri) {
        contentContainer.removeAllViews();
        if (webView == null) {
            webView = createWebView();
        }
        ViewGroup parent = (ViewGroup) webView.getParent();
        if (parent != null) {
            parent.removeView(webView);
        }
        contentContainer.addView(webView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));
        webView.loadUrl(launchUri.toString());
    }

    private WebView createWebView() {
        WebView view = new WebView(this);
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        settings.setUserAgentString(settings.getUserAgentString() + " CodeForgeAndroid/0.4");
        CookieManager.getInstance().setAcceptCookie(true);

        view.addJavascriptInterface(new AndroidJavascriptBridge(), "CodeForgeAndroid");
        view.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri target = request.getUrl();
                if (isCurrentServerUri(target)) {
                    return false;
                }
                openExternal(target);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                view.evaluateJavascript(
                    "document.documentElement.classList.add('codeforge-android'); true;",
                    null
                );
                dispatchPendingShares();
            }
        });

        view.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                WebView webView,
                ValueCallback<Uri[]> filePathCallback,
                FileChooserParams fileChooserParams
            ) {
                if (pendingFileChooser != null) {
                    pendingFileChooser.onReceiveValue(null);
                }
                pendingFileChooser = filePathCallback;
                try {
                    Intent chooserIntent = fileChooserParams.createIntent();
                    chooserIntent.addCategory(Intent.CATEGORY_OPENABLE);
                    startActivityForResult(chooserIntent, FILE_CHOOSER_REQUEST);
                    return true;
                } catch (ActivityNotFoundException error) {
                    pendingFileChooser = null;
                    Toast.makeText(MainActivity.this, "No file picker is available.", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }
        });
        return view;
    }

    private boolean enqueueIncomingShare(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) {
            return false;
        }
        CharSequence shared = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (shared == null) {
            return false;
        }
        String text = shared.toString().trim();
        if (text.isEmpty()) {
            return false;
        }
        pendingShares.addLast(text);
        return true;
    }

    private void enqueueCameraBitmap(Bitmap bitmap) {
        try {
            JSONObject payload = AndroidImagePayload.fromBitmap(
                bitmap,
                "camera-" + System.currentTimeMillis() + ".jpg",
                CAMERA_TARGET_BYTES
            );
            payload.put("kind", "image");
            pendingShares.addLast(SHARE_PREFIX + payload.toString());
            dispatchPendingShares();
        } catch (Exception error) {
            Toast.makeText(this, "CodeForge could not prepare the camera image.", Toast.LENGTH_SHORT).show();
        }
    }

    private void dispatchPendingShares() {
        if (webView == null || pendingShares.isEmpty()) {
            return;
        }
        String shareToDispatch = pendingShares.peekFirst();
        if (shareToDispatch == null) {
            return;
        }
        String javascript =
            "(() => {" +
            " if (typeof window.__codeforgeReceiveSharedText !== 'function') return false;" +
            " window.__codeforgeReceiveSharedText(" + JSONObject.quote(shareToDispatch) + ");" +
            " return true;" +
            "})()";
        webView.evaluateJavascript(javascript, result -> {
            if ("true".equals(result) && TextUtils.equals(pendingShares.peekFirst(), shareToDispatch)) {
                pendingShares.pollFirst();
                dispatchPendingShares();
                return;
            }
            if (!pendingShares.isEmpty() && webView != null) {
                webView.postDelayed(this::dispatchPendingShares, 300);
            }
        });
    }

    private PairingRequest pairingRequestFromIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) {
            return null;
        }
        Uri data = intent.getData();
        if (data == null || !"codeforge".equalsIgnoreCase(data.getScheme())) {
            return null;
        }
        if (!"connect".equalsIgnoreCase(data.getHost())) {
            return null;
        }
        String serverUrl = data.getQueryParameter("server");
        if (TextUtils.isEmpty(serverUrl)) {
            Toast.makeText(this, "Pairing link is missing the server address.", Toast.LENGTH_SHORT).show();
            return null;
        }
        String authToken = data.getQueryParameter("token");
        return new PairingRequest(serverUrl, authToken == null ? "" : authToken);
    }

    private boolean isCurrentServerUri(Uri target) {
        if (currentServerUrl == null) {
            return false;
        }
        Uri server = Uri.parse(currentServerUrl);
        if (!TextUtils.equals(server.getHost(), target.getHost())) {
            return false;
        }
        return effectivePort(server) == effectivePort(target);
    }

    private int effectivePort(Uri uri) {
        if (uri.getPort() >= 0) {
            return uri.getPort();
        }
        return "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80;
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException error) {
            Toast.makeText(this, "No app can open this link.", Toast.LENGTH_SHORT).show();
        }
    }

    private void createNotificationChannel() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
            NOTIFICATION_CHANNEL_ID,
            "CodeForge agent events",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("Approvals, user-input requests, and completed agent turns.");
        manager.createNotificationChannel(channel);
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < 33) {
            return;
        }
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            return;
        }
        requestPermissions(
            new String[]{Manifest.permission.POST_NOTIFICATIONS},
            NOTIFICATION_PERMISSION_REQUEST
        );
    }

    private void postAgentNotification(String kind, String title, String body) {
        if (foreground) {
            return;
        }
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }

        Intent openIntent = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            0,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification notification = new Notification.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_more)
            .setContentTitle(TextUtils.isEmpty(title) ? "CodeForge" : title)
            .setContentText(TextUtils.isEmpty(body) ? kind : body)
            .setStyle(new Notification.BigTextStyle().bigText(TextUtils.isEmpty(body) ? kind : body))
            .setContentIntent(contentIntent)
            .setAutoCancel(true)
            .build();
        manager.notify((int) (System.currentTimeMillis() & 0x7fffffff), notification);
    }

    private final class AndroidJavascriptBridge {
        @JavascriptInterface
        public void notify(String kind, String title, String body) {
            runOnUiThread(() -> postAgentNotification(kind, title, body));
        }
    }

    private static final class PairingRequest {
        private final String serverUrl;
        private final String authToken;

        private PairingRequest(String serverUrl, String authToken) {
            this.serverUrl = serverUrl;
            this.authToken = authToken;
        }
    }

    @SuppressWarnings("deprecation")
    private Bitmap cameraBitmapFromResult(Intent data) {
        if (data == null || data.getExtras() == null) {
            return null;
        }
        if (Build.VERSION.SDK_INT >= 33) {
            return data.getExtras().getParcelable("data", Bitmap.class);
        }
        Object value = data.getExtras().get("data");
        return value instanceof Bitmap ? (Bitmap) value : null;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == CAMERA_CAPTURE_REQUEST) {
            if (resultCode == RESULT_OK) {
                Bitmap bitmap = cameraBitmapFromResult(data);
                if (bitmap != null) {
                    enqueueCameraBitmap(bitmap);
                } else {
                    Toast.makeText(this, "Camera did not return an image.", Toast.LENGTH_SHORT).show();
                }
            }
            return;
        }

        if (requestCode != FILE_CHOOSER_REQUEST || pendingFileChooser == null) {
            return;
        }
        Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
        pendingFileChooser.onReceiveValue(result);
        pendingFileChooser = null;
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.getParent() != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (pendingFileChooser != null) {
            pendingFileChooser.onReceiveValue(null);
            pendingFileChooser = null;
        }
        if (webView != null) {
            webView.stopLoading();
            webView.removeJavascriptInterface("CodeForgeAndroid");
            webView.loadUrl("about:blank");
            webView.clearHistory();
            webView.removeAllViews();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
