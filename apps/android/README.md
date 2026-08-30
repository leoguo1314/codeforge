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

Debug builds explicitly allow cleartext LAN HTTP for development. Release builds reject `http://` connection profiles and disable cleartext traffic at the Android manifest/network-policy layer, so production-style deployments must use HTTPS/WSS.

## Pair Android

Android supports a credential-bearing pairing URI:

```text
codeforge://connect?server=<URL_ENCODED_SERVER>&token=<URL_ENCODED_TOKEN>
```

v0.3 adds a first-class **Pair Android** launcher to the CodeForge web/desktop workspace. The dialog pre-fills the current HTTP(S) origin when possible, accepts the `--auth-token` value, generates the pairing link entirely in the browser, and lets you copy it without sending the credential to a third-party service.

Example for a debug LAN server:

```text
codeforge://connect?server=http%3A%2F%2F192.168.1.20%3A3020&token=REPLACE_WITH_TOKEN
```

Open the link on Android and CodeForge stores the connection profile and connects immediately.

**Treat the pairing link as a credential when it contains a token.** Do not publish, log, paste into public QR generators, or share it in chat rooms. v0.3 intentionally does not call an external QR service. A future increment should add an offline/local QR renderer, then replace long-lived token-bearing links with short-lived, single-use pairing codes issued by the server.

## Android share target

CodeForge appears in Android's share sheet for text/URLs and images.

### Text and URL share

Sharing `text/*` into CodeForge appends the content to the current thread's Composer draft. It does **not** auto-send or execute anything.

```text
Browser / Notes / GitHub app
          |
          | Android Share
          v
CodeForge current Composer draft
          |
          | user reviews + sends
          v
Remote Coding Agent
```

### Image share

v0.3 adds a dedicated Android image share receiver for `image/*`.

```text
Gallery / Screenshot / Files
          |
          | Android Share
          v
ShareReceiverActivity
  |- decode with bounded sampling
  |- resize to a mobile-safe edge
  |- JPEG-compress to a Binder-safe payload
          |
          v
CodeForge Web bridge
          |
          v
Native ComposerImageAttachment
          |
       user sends
```

The shared image becomes a normal CodeForge Composer image attachment, so existing preview, attachment-count, size-limit, draft-persistence, and send-turn behavior is reused instead of creating a separate upload protocol. If the source app also supplies share text/caption, it is appended to the Composer draft.

v0.3 intentionally supports **one image per Android share intent**. Multi-image `ACTION_SEND_MULTIPLE` and generic non-image binary files are not implemented yet. CodeForge's current Composer transport is image-oriented, so generic file share requires a separate product/transport design rather than pretending arbitrary files are already supported.

## Agent notifications

Android creates a local notification channel for meaningful agent state transitions:

- approval required
- structured user input required
- current agent turn completed

Notifications are suppressed while the app is in the foreground and historical state does not trigger notifications merely because a thread was opened.

These notifications are currently generated through the live WebView/CodeForge session. Android may suspend a background WebView after extended idle periods, so this is **not yet a guaranteed push channel**. Reliable long-duration/background delivery should use server-side notification events plus FCM or another push transport in a later version.

## Security model

This Android version is intended for a private workstation/server connection, not for directly exposing CodeForge to the public Internet.

- WebSocket RPC is protected by the existing CodeForge `--auth-token` check.
- Release APKs disable cleartext network traffic and reject `http://` connection profiles.
- Debug APKs allow HTTP so a phone can connect directly to a development machine on the LAN.
- Provider credentials remain on the CodeForge Server host; they are not copied to Android.
- External links are handed to Android instead of being navigated inside the CodeForge WebView.
- The native JavaScript bridge exposes only a small notification method. Share delivery is initiated by native code into the CodeForge page; there is no generic native command executor.
- Android image shares are downscaled/compressed before being placed in an Intent/WebView payload to stay below practical Binder transfer limits.
- Shared text/images are inserted into the Composer as drafts and never auto-executed.
- The WebView does not navigate arbitrary external origins, which limits bridge exposure to the configured CodeForge server content.
- Pairing-link generation stays local and does not call an external QR/pairing service.

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
- Android single-image share into the native Composer attachment model
- Android local notifications for approval/input/completion transitions
- `codeforge://connect` quick-pairing links
- web/desktop Pair Android dialog with local pairing-link generation

## Next Android increments

1. Add an offline/local QR renderer inside the Pair Android dialog.
2. Add `ACTION_SEND_MULTIPLE` for multi-image share and evaluate explicit text/document ingestion separately from image attachments.
3. Add camera capture and a richer attachment picker.
4. Improve mobile-specific Chat/Header/Terminal interaction density and touch targets.
5. Add foreground/background connection lifecycle and reconnection status UI.
6. Add reliable server-driven push notifications for long-running turns.
7. Replace token-bearing pairing links with single-use, short-lived device pairing codes.
8. Strengthen server-side HTTP/session authentication for non-private-network deployments.
