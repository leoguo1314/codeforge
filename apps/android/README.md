# CodeForge Android

CodeForge Android is a thin mobile workspace client. Node.js, Codex CLI, Claude Agent SDK, Git, PTY, orchestration, and durable state remain on the CodeForge Server host. Android provides the mobile shell, remote workspace, native share/camera integration, connection lifecycle, and vendor push reception.

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
  |- Mobile Device Registry
  `- Durable Push Outbox
             |
             v
   CodeForge Push Gateway
      |- FCM HTTP v1
      `- Huawei Push REST
             |
             v
          Android
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

The stock/CI APK deliberately contains neither Firebase project identity nor a Huawei App ID. It remains a fully functional CodeForge remote client, but native background push reports `pushProvider = none` until a configured vendor build is installed.

## Native push providers

v0.8 keeps vendor SDKs behind one Android boundary:

```text
AndroidPushProvider
  |- FcmPushProvider
  `- HuaweiPushProvider
```

Provider selection is deterministic:

1. Huawei device + Huawei configuration -> Huawei Push Kit.
2. Otherwise, configured FCM -> FCM.
3. Otherwise, configured Huawei -> Huawei.
4. Otherwise no push-capable token is registered.

A missing provider configuration never clears a valid token owned by the other provider.

### Build with FCM enabled

CodeForge does not commit `google-services.json`. Firebase app identity is injected at build time:

```bash
export CODEFORGE_FIREBASE_APPLICATION_ID="1:1234567890:android:abcdef"
export CODEFORGE_FIREBASE_PROJECT_ID="your-firebase-project"
export CODEFORGE_FIREBASE_API_KEY="your-firebase-web-api-key"
export CODEFORGE_FIREBASE_SENDER_ID="1234567890"

gradle -p apps/android assembleDebug
```

All four values must be non-empty. The client explicitly initializes Firebase, obtains the opaque FCM registration token, persists it locally, and refreshes the Server registration. `FirebaseMessagingService.onNewToken()` handles token rotation.

### Build with Huawei Push Kit enabled

Huawei Push Kit is included through the Huawei Maven repository. No Huawei client secret is embedded in the APK. Inject the Huawei App ID at build time:

```bash
export CODEFORGE_HUAWEI_APP_ID="your-huawei-app-id"
gradle -p apps/android assembleDebug
```

`HuaweiPushProvider` obtains the opaque HMS token using `HmsInstanceId` and `HmsMessaging.DEFAULT_TOKEN_SCOPE`. `CodeForgeHuaweiMessagingService` receives token refreshes and data messages. Like the FCM service, it suppresses vendor rendering while a live CodeForge WebSocket is present so one canonical event produces one visible notification.

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

The web/desktop workspace provides **Pair Android** and locally generates the deep link/QR:

```text
codeforge://connect?server=<URL_ENCODED_SERVER>&token=<URL_ENCODED_TOKEN>
```

The QR encoder runs locally and does not call an external QR service. The current QR contains the long-lived Server auth token and must therefore be treated as a credential. A production pairing flow should replace it with a short-lived, single-use code.

## Android Share and Camera

Shared material always becomes a Composer draft and is never auto-sent or auto-executed.

Supported inputs:

- `text/*`: text and URLs
- `image/*` + `ACTION_SEND`: one image
- `image/*` + `ACTION_SEND_MULTIPLE`: up to four images
- `Camera -> Composer`: full-resolution private capture source

Camera capture uses Android `FileProvider` with a private `cache/camera/` staging file. The source is normalized into a bounded Composer image payload and the staging file is deleted after conversion. No external-storage permission is required.

## Canonical mobile notification contract

The Server has one provider-neutral notification vocabulary:

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

Agent notifications are derived from orchestration facts:

- `approval.requested` -> `approval`
- `user-input.requested` -> `input`
- `thread.turn-diff-completed` -> `complete`

The same canonical notification fans out to the live WebSocket path and the durable background-push path.

## Device registration and token lifecycle

Each Android installation owns one stable native installation ID. The narrow native bridge exposes only the registration descriptor required by the Web client:

```text
Android installation
        |
        | deviceId / provider / opaque token
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

Registration includes:

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

Registration refreshes on WebSocket reconnect and immediately when a native vendor token changes.

## v0.8 repository Push Gateway

v0.8 adds a zero-runtime-dependency Gateway under:

```text
scripts/mobile-push-gateway.mjs
```

Start it with:

```bash
export CODEFORGE_PUSH_GATEWAY_TOKEN="REPLACE_WITH_A_LONG_RANDOM_SHARED_SECRET"
export CODEFORGE_PUSH_GATEWAY_STATE_DIR="$HOME/.codeforge/push-gateway"
bun run push:gateway
```

Defaults:

```text
host: 127.0.0.1
port: 8787
POST /codeforge
GET  /healthz
```

Then point the CodeForge Server at it:

```bash
export CODEFORGE_PUSH_GATEWAY_URL="http://127.0.0.1:8787/codeforge"
export CODEFORGE_PUSH_GATEWAY_TOKEN="REPLACE_WITH_A_LONG_RANDOM_SHARED_SECRET"
```

On a single trusted host, loopback HTTP keeps the Gateway private. If the Gateway crosses a host/network boundary, use HTTPS and an authenticated private network or reverse proxy.

### FCM Gateway credentials

The Gateway sends FCM using HTTP v1. Keep the service-account JSON outside the repository:

```bash
export CODEFORGE_FCM_SERVICE_ACCOUNT_FILE="/secure/path/firebase-service-account.json"
```

The Gateway signs the OAuth service-account assertion, requests the `firebase.messaging` scope, caches the short-lived access token, and calls the FCM HTTP v1 `messages:send` endpoint. Provider credentials never enter Android, WebSocket payloads, or the Orchestration Event Store.

### Huawei Gateway credentials

For Huawei devices, configure the AppGallery Connect client credentials only on the Gateway host:

```bash
export CODEFORGE_HUAWEI_CLIENT_ID="your-huawei-client-id"
export CODEFORGE_HUAWEI_CLIENT_SECRET="your-huawei-client-secret"
```

The Gateway obtains a client-credentials access token and sends the canonical notification as a Huawei data message to the opaque HMS token.

## Durable delivery and idempotency

Background delivery is:

```text
Orchestration Event
        |
        v
Server PushBus
        |
        +--> mobile.notification --> live WebSocket
        |
        `--> PushDeliveryService
                  |
                  v
          SQLite mobile_push_outbox
                  |
             due worker
                  |
                  v
       repository Push Gateway
             /           \
       FCM HTTP v1    Huawei REST
             \           /
                  Android
```

Each target device gets one durable outbox row and one stable `deliveryId`. Requests to the Gateway include:

```text
Idempotency-Key: <deliveryId>
```

CodeForge uses **at-least-once** delivery. If the Server crashes after the Gateway accepted a request but before SQLite records success, the same `deliveryId` can be resent. The v0.8 Gateway persists a delivered marker per `deliveryId` under `CODEFORGE_PUSH_GATEWAY_STATE_DIR` and treats a later duplicate as success without re-sending to the vendor.

This deliberately avoids claiming impossible end-to-end exactly-once semantics.

### Retry and dead-letter policy

Failed Server -> Gateway delivery uses:

```text
5s -> 30s -> 2m -> 10m -> 30m
```

The sixth failed attempt becomes `dead`. A device that no longer has a valid push-capable registration also moves its pending delivery to `dead` rather than silently discarding it.

### Outbox observability

`mobile.getPushStatus` now includes:

```text
outbox.pending
outbox.retry
outbox.dead
outbox.delivered
```

These values are aggregated directly from `mobile_push_outbox`, alongside registered-device and push-capable-device counts.

The Server PushDelivery service also includes a controlled `replayDead(deliveryId)` primitive. Replay changes the existing row from `dead` to `retry`, resets the attempt counter, and deliberately preserves the original `deliveryId` so Gateway idempotency remains valid. v0.8 exposes the health counters through the existing RPC; dead-letter replay is currently a Server service/admin primitive rather than a mobile UI button.

## Security model

- WebSocket RPC uses the existing `--auth-token` check.
- Release APKs require HTTPS/WSS; Debug may use LAN HTTP.
- Claude/Codex credentials stay on the CodeForge Server host.
- FCM/Huawei registration tokens are opaque and stored only in Android SharedPreferences plus the Server SQLite device registry.
- Push tokens are not placed in the Orchestration Event Store and are not written to delivery logs.
- FCM service-account and Huawei client-secret credentials stay on the Gateway host.
- Firebase/Huawei application identity is injected at build time and is separate from server credentials.
- Gateway ingress supports a shared Bearer secret; production deployments should set it.
- Gateway idempotency state stores delivery IDs/timestamps, not vendor push tokens.
- External links leave the CodeForge WebView.
- The JavaScript bridge remains narrow; it is not a generic native command executor.
- Shared/camera content enters Composer as drafts and never auto-executes.
- Pairing QR generation remains local.

For Internet-facing deployment, place CodeForge and any non-loopback Gateway endpoint behind TLS plus an authenticated private network/reverse proxy; do not rely on the WebSocket token as the only perimeter control.

## Current Android capabilities

- Claude and Codex conversations
- streaming assistant output
- approvals and structured user input
- session recovery
- Git / worktree / commit / push / PR workflows
- remote Terminal / PTY
- Skills and project-file operations
- history, diffs, checkpoints, search
- text/URL and single/multi-image Android Share
- private full-resolution camera capture -> Composer
- native connection-state toolbar and network-aware reconnect
- canonical server-driven approval/input/completion notifications
- stable native installation identity and SQLite device registry
- FCM token acquisition/refresh and background data-message reception
- Huawei Push Kit token acquisition/refresh and background data-message reception
- durable SQLite push outbox with retry/dead-letter semantics
- outbox status counters through `mobile.getPushStatus`
- controlled dead-letter replay primitive
- repository-local FCM/Huawei Push Gateway with durable delivery-id deduplication
- `codeforge://connect` pairing + built-in offline QR

## Next increments

1. Replace long-lived token-bearing pairing QR links with expiring, single-use pairing codes.
2. Add a first-class admin UI for outbox/dead-letter inspection and replay.
3. Add retention/compaction policies for delivered outbox rows and Gateway idempotency markers.
4. Add Android-specific Chat / Terminal / Diff touch-density and gesture improvements.
5. Add stronger HTTP/session authentication for non-private-network deployments.
