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

The CodeForge web/desktop workspace includes a first-class **Pair Android** dialog. It pre-fills the current HTTP(S) origin when possible, accepts the `--auth-token` value, generates the pairing link in the browser, and in v0.4 renders a scannable QR locally with a dependency-free QR Model 2 encoder.

```text
CodeForge web / desktop
        |
        | local QR render only
        v
Android camera / QR scanner
        |
        | codeforge://connect?...token=...
        v
CodeForge Android connection profile
```

Example for a debug LAN server:

```text
codeforge://connect?server=http%3A%2F%2F192.168.1.20%3A3020&token=REPLACE_WITH_TOKEN
```

Open or scan the link on Android and CodeForge stores the connection profile and connects immediately.

**Treat the pairing QR/link as a credential when it contains a token.** Do not publish, log, upload, or share it. The QR is generated entirely inside CodeForge; no external QR endpoint or analytics service receives the server address or token. A later production pairing flow should replace long-lived token-bearing links with short-lived, single-use pairing codes issued by the server.

## Android share target

CodeForge appears in Android's share sheet for text/URLs and images. Shared material is inserted into the current Composer draft and is never auto-sent or auto-executed.

### Text and URL share

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

### Single and multi-image share

v0.4 accepts both `ACTION_SEND` and `ACTION_SEND_MULTIPLE` for `image/*` and supports up to four images in one Android share event.

```text
Gallery / Screenshot / Files
          |
          | Android Share (1..4 images)
          v
ShareReceiverActivity
  |- bounded image decode
  |- mobile-safe resize
  |- JPEG compression
  |- multi-image Binder budget
          |
          v
CodeForge typed Web bridge
          |
          v
Native ComposerImageAttachment[]
          |
       user sends
```

Single images target a larger per-image payload budget. Multi-image shares use a smaller per-image budget so the combined Intent/WebView payload remains below practical Binder transaction limits. Existing CodeForge preview, attachment-count, image-size, draft-persistence, and send-turn behavior is reused instead of introducing a separate upload protocol.

If the source app supplies a caption it is appended to the Composer draft once. If the current Composer does not have enough attachment slots for the entire multi-image share, CodeForge rejects that share with an explicit message instead of silently dropping images.

Generic non-image binary files are still not mapped into the image-only Composer transport. They need an explicit document/file attachment product contract rather than being disguised as images.

## Camera → Composer

v0.4 adds **Camera → Composer** to the Android overflow menu. It launches the system camera app and places the returned preview image into the current Composer through the same bounded image payload path used by Android Share.

This first camera increment intentionally uses the camera app's returned preview bitmap, which avoids storage permissions and temporary-file provider complexity. It is useful for quick photos of screens, whiteboards, devices, and error states, but it is not yet a full-resolution camera capture. A later increment can add a private full-resolution capture URI/FileProvider path.

## Share delivery reliability

Native-to-Web share delivery uses a FIFO queue. Text, image, multi-image, and camera payloads are delivered one event at a time and removed from the queue only after the CodeForge page confirms that its Android bridge accepted the event. This avoids corrupting structured payload boundaries when several Android intents arrive before the WebView is ready.

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
- The native JavaScript bridge exposes only a small notification method; it is not a generic native command executor.
- Android images are downscaled/compressed before entering Intent/WebView payloads.
- Multi-image shares are capped at four images and use a tighter per-image byte budget.
- Shared text/images/camera captures are inserted into the Composer as drafts and never auto-executed.
- The WebView does not navigate arbitrary external origins, which limits bridge exposure to configured CodeForge server content.
- Pairing-link and QR generation stays local and does not call an external pairing/QR service.

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
- Android single-image and up-to-four-image share into the native Composer attachment model
- Camera → Composer quick capture
- FIFO native share delivery
- Android local notifications for approval/input/completion transitions
- `codeforge://connect` quick-pairing links
- web/desktop Pair Android dialog with built-in offline QR rendering

## Next Android increments

1. Add full-resolution private camera capture instead of relying only on the camera preview bitmap.
2. Improve mobile-specific Chat/Header/Terminal interaction density and touch targets.
3. Add foreground/background connection lifecycle and explicit reconnect/offline status UI.
4. Add reliable server-driven push notifications for long-running turns.
5. Replace token-bearing pairing links with single-use, short-lived device pairing codes.
6. Design a first-class generic file/document attachment contract rather than overloading image attachments.
7. Strengthen server-side HTTP/session authentication for non-private-network deployments.
