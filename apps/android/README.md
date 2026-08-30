# CodeForge Android

CodeForge Android is a thin mobile workspace client. Node.js, Codex CLI, Claude Agent SDK, Git, PTY, orchestration, and persistence continue to run on the normal CodeForge Server host; Android provides the mobile shell, remote connection, native sharing/camera integration, connection state, and notifications.

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
  |- Skills / Project Files
  `- Mobile Device Registry / Push Delivery
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

## Connection lifecycle

The Android toolbar displays the WebSocket transport's real lifecycle:

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

Normal reconnects retain the existing 0.5s / 1s / 2s / 4s / 8s backoff. When the browser reports the network is offline, CodeForge stops pointless reconnect timers and closes a stale socket; when connectivity returns it retries immediately.

## Android Share and Camera

Shared material always becomes a Composer draft and is never auto-sent or auto-executed.

Supported inputs:

- `text/*`: text and URLs append to the current Composer
- `image/*` + `ACTION_SEND`: single image
- `image/*` + `ACTION_SEND_MULTIPLE`: up to four images
- `Camera -> Composer`: full-resolution private capture source

Camera capture uses Android `FileProvider` with a private `cache/camera/` staging file. The full-resolution source is normalized into a bounded Composer image payload and the staging file is deleted after conversion. No external-storage permission is required.

## Canonical mobile notification contract

The Server emits one provider-neutral notification vocabulary:

```text
mobile.notification
```

Payload:

```text
kind: approval | input | complete | info
threadId: thread id | null
title
body
createdAt
```

Agent notifications are derived from durable/live orchestration facts:

- `approval.requested` -> `approval`
- `user-input.requested` -> `input`
- `thread.turn-diff-completed` -> `complete`

Using turn-diff completion avoids guessing completion from transient provider/session `ready` states.

## v0.6 device registration

v0.6 adds a provider-neutral installation registry. The Android Web client creates one stable installation ID and refreshes the registration whenever the WebSocket opens.

```text
Android installation
        |
        | mobile.registerDevice
        v
CodeForge Server
        |
        v
SQLite: mobile_push_devices
```

Each registration contains:

```text
deviceId
platform: android
pushProvider: none | fcm | huawei | gateway
pushToken: opaque token | null
appVersion
deviceLabel
registeredAt
updatedAt
```

The stock v0.6 client currently registers as:

```text
pushProvider = none
pushToken    = null
```

That is intentional. v0.6 establishes the device identity, persistence, RPC, and delivery boundary without embedding Firebase or Huawei credentials. A future native FCM/Huawei provider can return its opaque token through the existing bridge and update the same device registration without changing Orchestration semantics.

The registration RPCs are:

```text
mobile.registerDevice
mobile.unregisterDevice
mobile.getPushStatus
mobile.sendTestNotification
```

`mobile.getPushStatus` reports both the current device record and Server delivery status, including registered-device and push-capable-device counts.

## v0.6 background Push Delivery Adapter

The real-time and background paths now fan out from the same canonical notification:

```text
Orchestration Event
        |
        v
Server PushBus
        |
        +--> mobile.notification
        |        |
        |        v
        |   live WebSocket
        |        |
        |        v
        |   Android local notification
        |
        `--> PushDeliveryService queue
                 |
                 v
          Push Delivery Adapter
                 |
                 v
        external push gateway
                 |
          +------+------+
          |             |
         FCM        Huawei Push Kit
          |             |
          +------+------+
                 |
                 v
              Android
```

The first executable delivery adapter is a generic HTTP Push Gateway. Configure it on the CodeForge Server host:

```bash
export CODEFORGE_PUSH_GATEWAY_URL="https://push.example.internal/codeforge"
export CODEFORGE_PUSH_GATEWAY_TOKEN="REPLACE_WITH_GATEWAY_BEARER_TOKEN"
```

These variables are explicitly passed through the repository's Turbo runtime environment.

When configured, CodeForge POSTs one request per push-capable device:

```json
{
  "version": 1,
  "device": {
    "deviceId": "installation-id",
    "platform": "android",
    "pushProvider": "fcm",
    "pushToken": "opaque-provider-token",
    "appVersion": "0.6.0",
    "deviceLabel": "Android device"
  },
  "notification": {
    "kind": "approval",
    "threadId": "thread-id",
    "title": "Approval required",
    "body": "CodeForge agent needs approval.",
    "createdAt": "2026-08-31T00:00:00.000Z"
  }
}
```

The gateway is responsible for translating the opaque provider/token pair into its FCM, Huawei Push Kit, or enterprise push call. This keeps cloud-vendor SDKs and credentials out of the CodeForge orchestration core.

If `CODEFORGE_PUSH_GATEWAY_URL` is absent, the Server reports the adapter as `disabled`. Device registration still works, but `mobile.sendTestNotification` does not claim that a background notification was queued.

### Delivery semantics in v0.6

The Push Delivery queue is deliberately asynchronous, so network latency or a failing push gateway cannot block Orchestration or WebSocket delivery. Gateway calls have a bounded timeout and failures are logged without logging push tokens.

The queue is currently **in-memory**, not a durable outbox. Therefore v0.6 background delivery is best-effort: a Server process crash between event creation and gateway delivery can lose a queued notification. A durable notification outbox with retry/backoff/dead-letter semantics is a later hardening step.

## Security model

- WebSocket RPC uses the existing `--auth-token` check.
- Release APKs require HTTPS/WSS; Debug may use LAN HTTP.
- Provider credentials stay on the CodeForge Server host.
- Push tokens stay in the Server's local SQLite device registry and are not placed in the Orchestration Event Store.
- Push tokens are not written to delivery logs.
- Push-gateway bearer credentials come from environment variables, not the repository.
- Production push gateways should use HTTPS and a private/authenticated network path.
- External links leave the CodeForge WebView.
- The JavaScript bridge remains narrow; it is not a generic native command executor.
- FileProvider exposes only private `cache/camera/` files and grants temporary URI access to the selected camera app.
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
- canonical `mobile.notification` semantics
- persistent Android installation registration
- SQLite mobile device registry
- push status/test RPCs
- asynchronous PushDeliveryService
- optional HTTP Push Gateway adapter
- `codeforge://connect` pairing + built-in offline QR

## Next increments

1. Add actual Android FCM token acquisition and token-refresh bridge.
2. Add Huawei Push Kit token acquisition for HMS-capable devices.
3. Replace the in-memory delivery queue with a durable outbox plus retry/backoff/dead-letter handling.
4. Replace long-lived token-bearing pairing QR links with expiring, single-use pairing codes.
5. Add Android-specific Chat / Terminal / Diff touch-density and gesture improvements.
6. Add stronger HTTP/session authentication for non-private-network deployments.
