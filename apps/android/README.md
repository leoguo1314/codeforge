# CodeForge Android

CodeForge Android is a thin mobile workspace client. It deliberately does **not** run Node.js, Codex CLI, Claude Agent SDK, Git, or PTY processes on the phone. Those continue to run in the normal CodeForge Server process on a development machine or server.

```text
Android App (native shell + WebView)
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

## Quick pairing deep link

Android v0.2 supports a credential-bearing pairing URI:

```text
codeforge://connect?server=<URL_ENCODED_SERVER>&token=<URL_ENCODED_TOKEN>
```

Example for a debug LAN server:

```text
codeforge://connect?server=http%3A%2F%2F192.168.1.20%3A3020&token=REPLACE_WITH_TOKEN
```

Encode that URI in a QR code and scan it with the phone camera, or open it as a link on the Android device. CodeForge stores the connection profile and opens the server immediately.

**Treat this pairing URI/QR as a credential.** v0.2 embeds the long-lived WebSocket token for convenience. Do not publish, log, or share the QR. A future production pairing flow should replace this with a short-lived, single-use pairing code issued by the server.

## Android share target

CodeForge appears in Android's share sheet for `text/*`. Sharing text or a URL into CodeForge appends it to the current thread's Composer draft; it does **not** auto-send or execute anything.

This makes flows such as the following possible:

```text
Browser / Notes / GitHub app
          |
          | Android Share
          v
CodeForge current Composer
          |
          | user reviews + sends
          v
Remote Coding Agent
```

## Agent notifications

Android v0.2 creates a local notification channel for meaningful agent state transitions:

- approval required
- structured user input required
- current agent turn completed

Notifications are suppressed while the app is in the foreground and historical state does not trigger notifications merely because a thread was opened.

These notifications are currently generated through the live WebView/CodeForge session. Android may suspend a background WebView after extended idle periods, so this is **not yet a guaranteed push channel**. Reliable long-duration/background delivery should be implemented in a later version with server-side notification events plus FCM or another push transport.

## Security model

This Android version is intended for a private workstation/server connection, not for directly exposing CodeForge to the public Internet.

- WebSocket RPC is protected by the existing CodeForge `--auth-token` check.
- Release APKs disable cleartext network traffic and the UI also rejects an `http://` connection profile.
- Debug APKs allow HTTP so a phone can connect directly to a development machine on the LAN.
- Provider credentials remain on the CodeForge Server host; they are not copied to Android.
- External links are handed to Android instead of being navigated inside the CodeForge WebView.
- The native JavaScript bridge exposes only a small notification method. Share delivery is initiated by native code into the CodeForge page; there is no generic native command executor.
- The WebView does not navigate arbitrary external origins, which limits bridge exposure to the configured CodeForge server content.

The server currently serves static UI/attachment HTTP routes separately from WebSocket auth. For Internet-facing deployment, put the entire endpoint behind TLS and an authenticated private network/reverse proxy rather than relying on the WebSocket token alone.

## Current capabilities

Because the Android client reuses the existing server and web application, it can use the same orchestration and capability plane as desktop/web:

- Claude and Codex conversations
- streaming assistant output
- plan/default interaction modes
- approvals and structured user input
- session recovery
- Git status/branch/worktree/commit/push/PR workflows
- remote Terminal/PTY sessions
- Skills management
- project file search/read/write
- image attachment selection from Android
- thread history, diffs, checkpoints, and search
- Android text/URL share target
- Android local notifications for approval/input/completion transitions
- `codeforge://connect` quick-pairing links and QR-compatible pairing payloads

## Next Android increments

1. Add a first-class desktop/web "Pair Android" dialog that generates a QR rather than requiring an external QR encoder.
2. Extend Android Share from text/URLs to images and generic files.
3. Add camera capture and a richer attachment picker.
4. Improve mobile-specific Chat/Header/Terminal interaction density and touch targets.
5. Add foreground/background connection lifecycle and reconnection status UI.
6. Add reliable server-driven push notifications for long-running turns.
7. Replace token-bearing pairing links with single-use, short-lived device pairing codes.
8. Strengthen server-side HTTP/session authentication for non-private-network deployments.
