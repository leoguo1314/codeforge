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
  `- Mobile Device Registry / Durable Push Outbox
```

## Build

Requirements:

- JDK 17
- Android SDK 36
- Android Gradle Plugin 9.3.1
- Gradle 9.5.0

Stock build:

```bash
cd apps/android
gradle wrapper --gradle-version 9.5.0
./gradlew assembleDebug
```

The APK is emitted under `apps/android/app/build/outputs/apk/debug/`.

The stock/CI APK deliberately has no Firebase project configuration. It remains a fully functional CodeForge remote client, but its native push provider reports `none` until a configured vendor build is installed.

## Build with FCM enabled

v0.7 includes the Firebase Messaging runtime, but CodeForge does not commit `google-services.json` or bind the repository to a Firebase project. Firebase app identity is injected at build time:

```bash
export CODEFORGE_FIREBASE_APPLICATION_ID="1:1234567890:android:abcdef"
export CODEFORGE_FIREBASE_PROJECT_ID="your-firebase-project"
export CODEFORGE_FIREBASE_API_KEY="your-firebase-web-api-key"
export CODEFORGE_FIREBASE_SENDER_ID="1234567890"

gradle -p apps/android assembleDebug
```

All four values must be non-empty before the native FCM provider activates. When configured, CodeForge explicitly initializes Firebase, calls `FirebaseMessaging.getInstance().getToken()`, persists the opaque registration token, and updates the Server device registration. `FirebaseMessagingService.onNewToken()` updates the same installation immediately when FCM rotates the token.

The provider boundary is vendor-neutral:

```text
AndroidPushProvider
  |- FcmPushProvider       <-- implemented in v0.7
  `- HuaweiPushProvider    <-- reserved next provider
```

The shared Server contract already supports `pushProvider = huawei`; adding Huawei Push Kit does not require changing Orchestration or the WebSocket notification vocabulary.

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

## Device registration and token lifecycle

Each Android installation owns a stable native installation ID in SharedPreferences. The WebView reads the narrow native `pushRegistration()` descriptor and registers it through the existing RPC:

```text
Android installation
        |
        | native deviceId / provider / token
        v
Web AndroidDeviceRegistration
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

Registration is refreshed on WebSocket reconnect and, beginning in v0.7, immediately when the native push token changes:

```text
FCM onNewToken
   -> PushRegistrationStore
   -> native registration-changed broadcast
   -> Web bridge callback
   -> mobile.registerDevice
```

The registration RPCs are:

```text
mobile.registerDevice
mobile.unregisterDevice
mobile.getPushStatus
mobile.sendTestNotification
```

`mobile.getPushStatus` reports both the current device record and Server delivery status, including registered-device and push-capable-device counts.

## v0.7 durable background Push Delivery

Both real-time and background notification paths fan out from the same canonical notification:

```text
Orchestration Event
        |
        v
Server PushBus
        |
        +--> mobile.notification --> live WebSocket --> Android local notification
        |
        `--> PushDeliveryService
                  |
                  v
          SQLite mobile_push_outbox
                  |
             due worker
                  |
                  v
          HTTP Push Gateway
             /          \
           FCM          Huawei
            |              |
            +------ Android+
```

Configure the HTTP Push Gateway on the CodeForge Server host:

```bash
export CODEFORGE_PUSH_GATEWAY_URL="https://push.example.internal/codeforge"
export CODEFORGE_PUSH_GATEWAY_TOKEN="REPLACE_WITH_GATEWAY_BEARER_TOKEN"
```

These variables are explicitly passed through the repository's Turbo runtime environment.

For every push-capable device, CodeForge persists one outbox row before remote delivery. The Gateway request is version 2:

```json
{
  "version": 2,
  "deliveryId": "durable-delivery-uuid",
  "attempt": 1,
  "device": {
    "deviceId": "installation-id",
    "platform": "android",
    "pushProvider": "fcm",
    "pushToken": "opaque-provider-token",
    "appVersion": "0.7.0",
    "deviceLabel": "Google Pixel"
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

The request also carries:

```text
Idempotency-Key: <deliveryId>
```

The gateway must treat `deliveryId` as an idempotency key. CodeForge deliberately implements **at-least-once** delivery rather than pretending to provide exactly-once semantics: if the Server crashes after the Gateway accepts a request but before SQLite records success, the same `deliveryId` can be replayed.

### Retry and dead-letter policy

A failed delivery is retried using these delays:

```text
5s -> 30s -> 2m -> 10m -> 30m
```

The sixth failed attempt moves the row to `dead`. If the target device has been removed or no longer has a push-capable token, the row also moves to `dead` instead of silently disappearing. Delivered, retry, and dead-letter state remain auditable in `mobile_push_outbox`.

### Gateway -> FCM contract

For FCM devices, the gateway should send a **data message** carrying the canonical notification fields, for example:

```text
kind
threadId
title
body
createdAt
deliveryId
```

Using a data message lets `CodeForgeFirebaseMessagingService` control rendering consistently. The Android service posts the notification when the WebSocket path is unavailable. If the process still has a live WebSocket, the FCM renderer suppresses itself so the real-time `mobile.notification` path remains the single visible notification.

The gateway remains responsible for cloud credentials and translating `device.pushProvider + pushToken` to the corresponding vendor API. Firebase service-account credentials therefore stay outside the CodeForge Android APK and outside Orchestration.

If `CODEFORGE_PUSH_GATEWAY_URL` is absent, the Server reports the adapter as `disabled`; device registration still works, but background delivery is not claimed as configured.

## Security model

- WebSocket RPC uses the existing `--auth-token` check.
- Release APKs require HTTPS/WSS; Debug may use LAN HTTP.
- Claude/Codex provider credentials stay on the CodeForge Server host.
- Android vendor tokens are opaque and stored only in Android SharedPreferences plus the Server's local SQLite device registry.
- Push tokens are not placed in the Orchestration Event Store and are not written to delivery logs.
- Push-gateway bearer credentials come from environment variables, not the repository.
- Firebase project identity is injected at build time; Firebase server/service-account credentials are not embedded in the APK.
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
- persistent native Android installation identity
- SQLite mobile device registry
- push status/test RPCs
- FCM token acquisition and `onNewToken` refresh when Firebase build config is supplied
- FCM background message service
- durable SQLite push outbox
- retry/backoff/dead-letter delivery
- HTTP Push Gateway v2 with `deliveryId` idempotency key
- `codeforge://connect` pairing + built-in offline QR

## Next increments

1. Implement the `HuaweiPushProvider` behind the existing `AndroidPushProvider` interface for HMS-capable devices.
2. Add Server/API observability for pending/retry/dead outbox counts and controlled dead-letter replay.
3. Replace long-lived token-bearing pairing QR links with expiring, single-use pairing codes.
4. Add Android-specific Chat / Terminal / Diff touch-density and gesture improvements.
5. Add stronger HTTP/session authentication for non-private-network deployments.
