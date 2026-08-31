package ai.codeforge.android;

/** Process-local signal used only to suppress duplicate vendor/local notifications. */
final class AppRuntimeState {
    private static volatile boolean liveWebSocket;

    private AppRuntimeState() {}

    static void setConnectionState(String state) {
        liveWebSocket = "open".equals(state);
    }

    static boolean hasLiveWebSocket() {
        return liveWebSocket;
    }
}
