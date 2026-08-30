# CodeForge Android

CodeForge Android is a thin mobile workspace client. It deliberately does **not** run Node.js, Codex CLI, Claude Agent SDK, Git, or PTY processes on the phone. Those continue to run in the normal CodeForge Server process on a development machine or server.

```text
Android App (WebView)
        |
        | HTTPS + WebSocket
        v
CodeForge Server
  |- Orchestration / Event Store
  |- Claude / Codex Provider Adapters
  |- Git / Worktree
  |- Terminal / PTY
  `- Skills / Project Files
```

The Android app loads the web UI served by CodeForge Server. The app appends the configured auth token to the page URL; `apps/web/src/wsTransport.ts` preserves that token when it opens the same-origin WebSocket connection.

## Requirements

- Android Studio Quail 3 (2026.1.3) or newer
- JDK 17
- Android SDK 36
- Android Gradle Plugin 9.3.1
- Gradle 9.5.0

The repository connector cannot add the binary Gradle wrapper JAR, so generate the wrapper once after checkout:

```bash
cd apps/android
gradle wrapper --gradle-version 9.5.0
```

Then build:

```bash
./gradlew assembleDebug
```

The debug APK is written under `apps/android/app/build/outputs/apk/debug/`.

## Start a CodeForge Server for Android

Build the existing web client and server first:

```bash
bun install
bun run --cwd apps/web build
bun run --cwd apps/server build
```

Start CodeForge on an interface reachable by the phone and require a strong WebSocket token:

```bash
bun run --cwd apps/server start -- \
  --host 0.0.0.0 \
  --port 3020 \
  --no-browser \
  --auth-token "REPLACE_WITH_A_LONG_RANDOM_TOKEN"
```

For a LAN debug build, enter for example:

```text
Server URL: http://192.168.1.20:3020
Auth token: <same token passed to --auth-token>
```

For a release build, expose CodeForge through HTTPS/WSS (for example through a private VPN/Tailnet plus TLS or a trusted reverse proxy) and enter the HTTPS URL. Release builds intentionally reject cleartext HTTP.

## Security model

This first Android version is intended for a private workstation/server connection, not for directly exposing CodeForge to the public Internet.

- WebSocket RPC is protected by the existing CodeForge `--auth-token` check.
- Release APKs disable cleartext network traffic.
- Debug APKs allow HTTP so a phone can connect directly to a development machine on the LAN.
- The app never injects a JavaScript bridge into remote content.
- External links are handed to Android instead of being navigated inside the CodeForge WebView.
- Provider credentials remain on the CodeForge Server host; they are not copied to Android.

The server currently serves static UI/attachment HTTP routes separately from WebSocket auth. For Internet-facing deployment, put the entire endpoint behind TLS and an authenticated private network/reverse proxy rather than relying on the WebSocket token alone.

## Current MVP capabilities

Because the Android client reuses the existing server and web application, the MVP can use the same orchestration and capability plane as desktop/web:

- Claude and Codex conversations
- streaming assistant output
- plan/default interaction modes
- approvals and structured user input
- session recovery
- Git status/branch/worktree/commit/push/PR workflows
- remote Terminal/PT​​Y sessions
- Skills management
- project file search/read/write
- image attachment selection from Android
- thread history, diffs, checkpoints, and search

## Next Android increments

1. Responsive/mobile UX pass for Chat, Sidebar, Diff and Terminal.
2. Android share-target integration: share text/images/files directly into a CodeForge thread.
3. Camera capture and richer attachment picker.
4. Foreground/background connection lifecycle and reconnection status UI.
5. Push notifications for approval requests and long-running turn completion.
6. QR/device-pairing flow so users do not manually copy server URLs/tokens.
7. Stronger server-side HTTP/session authentication for non-private-network deployments.
