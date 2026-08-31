import type {
  MobileDeviceRegistration,
  MobileNotificationPayload,
  MobilePushServerStatus,
} from "@codeforge/contracts";
import { Effect, Layer } from "effect";

import { MobileDeviceRegistry } from "../Services/MobileDeviceRegistry.ts";
import { PushDeliveryService, type PushDeliveryShape } from "../Services/PushDelivery.ts";
import { PushOutbox } from "../Services/PushOutbox.ts";

const DELIVERY_BATCH_SIZE = 20;
const DELIVERY_POLL_INTERVAL_MS = 1_000;
const MAX_ATTEMPTS = 6;
const RETRY_DELAYS_MS = [5_000, 30_000, 120_000, 600_000, 1_800_000] as const;

type GatewayConfig = {
  readonly url: string;
  readonly authorization: string | null;
};

const resolveGatewayConfig = (): GatewayConfig | null => {
  const rawUrl = process.env.CODEFORGE_PUSH_GATEWAY_URL?.trim();
  if (!rawUrl) return null;

  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    const token = process.env.CODEFORGE_PUSH_GATEWAY_TOKEN?.trim();
    return {
      url: parsed.toString(),
      authorization: token ? `Bearer ${token}` : null,
    };
  } catch {
    return null;
  }
};

const sleep = (milliseconds: number) =>
  Effect.promise<void>(() => new Promise((resolve) => setTimeout(resolve, milliseconds)));

const errorSummary = (cause: unknown): string => {
  const value = cause instanceof Error ? cause.message : String(cause);
  return value.length > 500 ? `${value.slice(0, 497)}...` : value;
};

const retryDelayMs = (attemptCount: number): number =>
  RETRY_DELAYS_MS[Math.min(Math.max(attemptCount - 1, 0), RETRY_DELAYS_MS.length - 1)] ??
  RETRY_DELAYS_MS.at(-1)!;

const sendToGateway = (
  config: GatewayConfig,
  deliveryId: string,
  attempt: number,
  device: MobileDeviceRegistration,
  notification: MobileNotificationPayload,
) =>
  Effect.tryPromise({
    try: async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const headers: Record<string, string> = {
          "content-type": "application/json",
          "user-agent": "CodeForge-PushDelivery/0.8",
          "idempotency-key": deliveryId,
        };
        if (config.authorization) {
          headers.authorization = config.authorization;
        }

        const response = await fetch(config.url, {
          method: "POST",
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            version: 2,
            deliveryId,
            attempt,
            device: {
              deviceId: device.deviceId,
              platform: device.platform,
              pushProvider: device.pushProvider,
              pushToken: device.pushToken,
              appVersion: device.appVersion,
              deviceLabel: device.deviceLabel,
            },
            notification,
          }),
        });
        if (!response.ok) {
          throw new Error(`Push gateway returned HTTP ${response.status}`);
        }
      } finally {
        clearTimeout(timeout);
      }
    },
    catch: (cause) => cause,
  });

const makePushDelivery = Effect.gen(function* () {
  const registry = yield* MobileDeviceRegistry;
  const outbox = yield* PushOutbox;
  const gateway = resolveGatewayConfig();

  const persistNotification = (
    notification: MobileNotificationPayload,
    targetDeviceId?: string,
  ) =>
    Effect.gen(function* () {
      if (!gateway) return;

      const registrations = yield* registry.list();
      const devices = registrations.filter(
        (device) =>
          device.pushProvider !== "none" &&
          device.pushToken !== null &&
          (targetDeviceId === undefined || device.deviceId === targetDeviceId),
      );

      yield* Effect.forEach(devices, (device) => outbox.enqueue(device.deviceId, notification), {
        concurrency: 1,
        discard: true,
      });
    });

  const deliverOne = (item: {
    readonly deliveryId: string;
    readonly deviceId: string;
    readonly notification: MobileNotificationPayload;
    readonly attemptCount: number;
  }) =>
    Effect.gen(function* () {
      if (!gateway) return;

      const device = yield* registry.get(item.deviceId);
      const nextAttempt = item.attemptCount + 1;
      if (!device || device.pushProvider === "none" || device.pushToken === null) {
        yield* outbox.markDead(item.deliveryId, nextAttempt, "device is no longer push-capable");
        return;
      }

      const result = yield* Effect.exit(
        sendToGateway(gateway, item.deliveryId, nextAttempt, device, item.notification),
      );
      if (result._tag === "Success") {
        yield* outbox.markDelivered(item.deliveryId, new Date().toISOString());
        return;
      }

      const failure = errorSummary(result.cause);
      if (nextAttempt >= MAX_ATTEMPTS) {
        yield* outbox.markDead(item.deliveryId, nextAttempt, failure);
        yield* Effect.logWarning("mobile push delivery moved to dead letter", {
          deliveryId: item.deliveryId,
          deviceId: item.deviceId,
          provider: device.pushProvider,
          attempt: nextAttempt,
          error: failure,
        });
        return;
      }

      const nextAttemptAt = new Date(Date.now() + retryDelayMs(nextAttempt)).toISOString();
      yield* outbox.markRetry(item.deliveryId, nextAttempt, nextAttemptAt, failure);
      yield* Effect.logWarning("mobile push delivery scheduled for retry", {
        deliveryId: item.deliveryId,
        deviceId: item.deviceId,
        provider: device.pushProvider,
        attempt: nextAttempt,
        nextAttemptAt,
        error: failure,
      });
    });

  const processDue = Effect.gen(function* () {
    if (!gateway) return;
    const due = yield* outbox.listDue(new Date().toISOString(), DELIVERY_BATCH_SIZE);
    yield* Effect.forEach(due, deliverOne, { concurrency: 4, discard: true });
  }).pipe(
    Effect.catch((cause) =>
      Effect.logWarning("mobile push outbox sweep failed", {
        cause,
      }),
    ),
  );

  yield* Effect.forkScoped(
    Effect.forever(
      processDue.pipe(
        Effect.flatMap(() => sleep(DELIVERY_POLL_INTERVAL_MS)),
      ),
    ),
  );

  const enqueue: PushDeliveryShape["enqueue"] = (notification, targetDeviceId) =>
    persistNotification(notification, targetDeviceId).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("failed to persist mobile push notification", {
          cause,
          targetDeviceId: targetDeviceId ?? null,
        }),
      ),
    );

  const getStatus: PushDeliveryShape["getStatus"] = () =>
    Effect.gen(function* () {
      const devices = yield* registry.list();
      const outboxStats = yield* outbox.stats();
      return {
        configured: gateway !== null,
        adapter: gateway ? "http-gateway" : "disabled",
        registeredDevices: devices.length,
        pushCapableDevices: devices.filter(
          (device) => device.pushProvider !== "none" && device.pushToken !== null,
        ).length,
        outbox: outboxStats,
      } satisfies MobilePushServerStatus;
    });

  const sendTest: PushDeliveryShape["sendTest"] = (deviceId) =>
    Effect.gen(function* () {
      if (!gateway) return false;
      const device = yield* registry.get(deviceId);
      if (!device || device.pushProvider === "none" || device.pushToken === null) {
        return false;
      }
      const persisted = yield* Effect.exit(
        persistNotification(
          {
            kind: "info",
            threadId: null,
            title: "CodeForge push test",
            body: "Background push delivery is configured for this device.",
            createdAt: new Date().toISOString(),
          },
          deviceId,
        ),
      );
      return persisted._tag === "Success";
    });

  const replayDead: PushDeliveryShape["replayDead"] = (deliveryId) =>
    outbox.replayDead(deliveryId);

  return { enqueue, getStatus, sendTest, replayDead } satisfies PushDeliveryShape;
});

export const PushDeliveryLive = Layer.effect(PushDeliveryService, makePushDelivery);
