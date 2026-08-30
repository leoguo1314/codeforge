# CodeForge Android

CodeForge Android is a thin mobile workspace client. Node.js, Codex CLI, Claude Agent SDK, Git, PTY, orchestration, and persistence continue to run on the normal CodeForge Server host; Android provides the mobile shell, remote connection, native sharing/camera integration, and notifications.

```text
Android App (native shell + WebView)
        |
        | HTTPS/WSS
        v
CodeForge Server
  |- Orchestration / Event Store
  |- Claude / Codex Provider Adapters
  |- Git / Worktree
  |- Terminal / PTY
  `- Skills / Project Files
```

## Build

Requirements:

- JDK 17
- Android SDK 36
- Android Gradle Plugin 9.3.1
- Gradle 9.5.0

```bash
cd apps/android
gradle wrapper --gradle-version 9.5.0
./gradlew assembleDebug
```

The APK is emitted under `apps/android/app/build/outputs/apk/debug/`.

## Connect to CodeForge Server

```bash
bun install
bun run --cwd apps/web build
bun run --cwd apps/server build
bun run --cwd apps/server start -- \
  --host 0.0.0.0 \
  --port 3020 \
  --no-browser \
  --auth-token "REPLACE_WITH_A_LONG_RANDOM_TOKEN"
```

Debug builds allow LAN HTTP for development. Release builds reject `http://` profiles and disable cleartext traffic, so production-style deployments require HTTPS/WSS.

## Pair Android

The web/desktop workspace provides **Pair Android**. It locally generates both the deep link and QR code:

```text
codeforge://connect?server=<URL_ENCODED_SERVER>&token=<URL_ENCODED_TOKEN>
```

The QR Model 2 encoder is implemented inside CodeForge and does not call an external QR service. Treat the QR/link as a credential while it contains the long-lived auth token. A future production pairing flow should replace this with short-lived, single-use device pairing codes.

## v0.5 connection lifecycle

v0.5 exposes the real WebSocket lifecycle to the Android native shell:

```text
Connecting -> Connected
     |           |
     | socket loss
     v           v
Reconnecting <- Closed
     |
     | browser/network offline
     v
Offline
     |
     | Android/browser online event
     v
Immediate reconnect
```

The Android toolbar displays `Connecting`, `Connected`, `Reconnecting`, or `Offline` using the Web transport's authoritative state. Normal reconnects retain the existing 0.5s / 1s / 2s / 4s / 8s backoff. When the browser reports the network is offline, CodeForge stops pointless reconnect timers and closes a stale socket; when connectivity returns it retries immediately rather than waiting for the previous backoff window.

## Android Share

Shared material always becomes a Composer draft and is never auto-sent or auto-executed.

Supported inputs:

- `text/*`: text and URLs append to the current Composer
- `image/*` + `ACTION_SEND`: single image
- `image/*` + `ACTION_SEND_MULTIPLE`: up to four images

Images are decoded with bounded sampling, resized/compressed for a safe Intent/WebView transfer budget, then converted into normal `ComposerImageAttachment` objects. Existing CodeForge preview, draft persistence, attachment limits, and send-turn behavior are reused.

Native-to-Web delivery uses a FIFO queue. Each text/image/camera event is removed only after the page confirms its Android bridge accepted it.

## v0.5 full-resolution Camera -> Composer

`Camera -> Composer` now uses the Android `FileProvider` output path instead of relying on the camera app's thumbnail result:

```text
System Camera
     |
     | MediaStore.EXTRA_OUTPUT
     v
private cache FileProvider URI
     |
     | full-resolution JPEG source
     v
AndroidImagePayload normalization
     |
     | bounded JPEG/data URL
     v
CodeForge Composer
```

The full-resolution source photo is captured into the app's private cache directory. No external-storage permission is required. After CodeForge creates the bounded Composer payload, the staging image is deleted. The Agent receives the normalized attachment rather than an unbounded full-resolution Binder/WebView payload.

## v0.5 mobile notification contract

The Server emits a provider-neutral WebSocket channel:

```text
mobile.notification
```

Payload:

```text
kind: approval | input | complete
threadId
title
body
createdAt
```

It is derived only from durable/live orchestration facts:

- `approval.requested` -> `approval`
- `user-input.requested` -> `input`
- `thread.turn-diff-completed` -> `complete`

Using turn-diff completion avoids guessing completion from transient provider/session `ready` states.

The live Android notification path now consumes this canonical server channel directly:

```text
Orchestration Event
        |
        v
Server PushBus
        |
        +--> orchestration.domainEvent
        |
        `--> mobile.notification
                    |
                    v
              Web WsTransport
                    |
                    v
          Android native notification
```

The previous Android-side notification inference from projected thread state has been removed, so a future FCM/Huawei Push/enterprise delivery adapter can use the same `mobile.notification` semantics without duplicating approval/input/completion rules.

v0.5 does **not** commit Firebase credentials or claim guaranteed app-killed push. Local notifications require the live WebView/WebSocket path to receive the server event. Reliable notification delivery after Android suspends or kills the app still requires device registration plus a server push-delivery adapter in a later version.

## Security model

- WebSocket RPC uses the existing `--auth-token` check.
- Release APKs require HTTPS/WSS; Debug may use LAN HTTP.
- Provider credentials stay on the CodeForge Server host.
- External links leave the CodeForge WebView.
- The JavaScript bridge is deliberately narrow: agent notification + connection-state display. It is not a generic native command executor.
- FileProvider exposes only private `cache/camera/` files and grants temporary URI access to the selected camera app.
- Camera staging files are deleted after payload creation.
- Shared content enters the Composer as drafts and never auto-executes.
- Multi-image share is capped at four images.
- Pairing QR generation remains local.

For Internet-facing deployment, place the whole CodeForge endpoint behind TLS plus an authenticated private network/reverse proxy; do not rely on the WebSocket token as the only perimeter control.

## Current Android capabilities

- Claude and Codex conversations
- streaming assistant output
- approvals and structured user input
- session recovery
- Git / worktree / commit / push / PR workflows
- remote Terminal / PTY
- Skills and project-file operations
- thread history, diffs, checkpoints, search
- text/URL Android Share
- single/multi-image Android Share
- full-resolution private camera capture -> bounded Composer attachment
- FIFO native share delivery
- native connection-state toolbar
- network-aware immediate reconnect
- server-driven local approval/input/completion notifications
- normalized Server `mobile.notification` channel
- `codeforge://connect` pairing + built-in offline QR

## Next increments

1. Add a push-delivery adapter interface and device registration flow; then implement FCM and/or Huawei Push Kit without changing orchestration semantics.
2. Replace long-lived token-bearing QR links with expiring, single-use device pairing codes.
3. Add Android-specific Chat / Terminal / Diff touch-density and gesture improvements.
4. Design first-class generic document/file attachments instead of overloading image transport.
5. Add stronger HTTP/session authentication for non-private-network deployments.
