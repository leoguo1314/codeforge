package ai.codeforge.android;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
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

import java.util.Locale;

/**
 * Thin Android workspace client for CodeForge.
 *
 * Agent runtimes, Git, Terminal, Skills, persistence, and orchestration stay on
 * the remote CodeForge Server. This activity only hosts the existing web UI,
 * persists the server profile, and supplies Android-native file selection.
 */
public final class MainActivity extends Activity {
    private static final String PREFS = "codeforge_android";
    private static final String PREF_SERVER_URL = "server_url";
    private static final String PREF_AUTH_TOKEN = "auth_token";
    private static final int FILE_CHOOSER_REQUEST = 7001;

    private static final int MENU_RELOAD = 1;
    private static final int MENU_CHANGE_CONNECTION = 2;
    private static final int MENU_DISCONNECT = 3;

    private SharedPreferences preferences;
    private FrameLayout contentContainer;
    private TextView serverLabel;
    private WebView webView;
    private ValueCallback<Uri[]> pendingFileChooser;
    private String currentServerUrl;
    private String currentAuthToken;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        setContentView(createRootView());

        String savedServerUrl = preferences.getString(PREF_SERVER_URL, "");
        String savedAuthToken = preferences.getString(PREF_AUTH_TOKEN, "");
        if (!TextUtils.isEmpty(savedServerUrl)) {
            connect(savedServerUrl, savedAuthToken == null ? "" : savedAuthToken, false);
        } else {
            showConnectionForm(null);
        }
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
        menu.getMenu().add(0, MENU_RELOAD, 0, "Reload");
        menu.getMenu().add(0, MENU_CHANGE_CONNECTION, 1, "Connection");
        menu.getMenu().add(0, MENU_DISCONNECT, 2, "Disconnect");
        menu.setOnMenuItemClickListener(item -> {
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
        settings.setUserAgentString(settings.getUserAgentString() + " CodeForgeAndroid/0.1");
        CookieManager.getInstance().setAcceptCookie(true);

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

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
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
