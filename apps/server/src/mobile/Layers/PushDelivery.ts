import type {
  MobileDeviceRegistration,
  MobileNotificationPayload,
  MobilePushServerStatus,
} from "@codeforge/contracts";
import { Effect, Layer, Queue } from "effect";

import { MobileDeviceRegistry } from "../Services/MobileDeviceRegistry.ts";
import { PushDeliveryService, type PushDeliveryShape } from "../Services/PushDelivery.ts";

type DeliveryJob = {
  readonly notification: MobileNotificationPayload;
  readonly targetDeviceId: string | null;
};

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

const sendToGateway = (
  config: GatewayConfig,
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
          "user-agent": "CodeForge-PushDelivery/0.6",
        };
        if (config.authorization) {
          headers.authorization = config.authorization;
        }

        const response = await fetch(config.url, {
          method: "POST",
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            version: 1,
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
  const queue = yield* Queue.unbounded<DeliveryJob>();
  const gateway = resolveGatewayConfig();

  const deliverJob = (job: DeliveryJob) =>
    Effect.gen(function* () {
      if (!gateway) return;

      const registrations = yield* registry.list();
      const devices = registrations.filter(
        (device) =>
          device.pushProvider !== "none" &&
          device.pushToken !== null &&
          (job.targetDeviceId === null || device.deviceId === job.targetDeviceId),
      );

      yield* Effect.forEach(
        devices,
        (device) =>
          sendToGateway(gateway, device, job.notification).pipe(
            Effect.tapError((cause) =>
              Effect.logWarning("mobile push gateway delivery failed", {
                deviceId: device.deviceId,
                provider: device.pushProvider,
                cause,
              }),
            ),
            Effect.ignore,
          ),
        { concurrency: 4 },
      );
    }).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("mobile push delivery job failed", {
          cause,
        }),
      ),
    );

  yield* Effect.forkScoped(
    Effect.forever(Queue.take(queue).pipe(Effect.flatMap(deliverJob))),
  );

  const enqueue: PushDeliveryShape["enqueue"] = (notification, targetDeviceId) =>
    Queue.offer(queue, {
      notification,
      targetDeviceId: targetDeviceId ?? null,
    }).pipe(Effect.asVoid);

  const getStatus: PushDeliveryShape["getStatus"] = () =>
    registry.list().pipe(
      Effect.map((devices): MobilePushServerStatus => ({
        configured: gateway !== null,
        adapter: gateway ? "http-gateway" : "disabled",
        registeredDevices: devices.length,
        pushCapableDevices: devices.filter(
          (device) => device.pushProvider !== "none" && device.pushToken !== null,
        ).length,
      })),
    );

  const sendTest: PushDeliveryShape["sendTest"] = (deviceId) =>
    Effect.gen(function* () {
      if (!gateway) return false;
      const device = yield* registry.get(deviceId);
      if (!device || device.pushProvider === "none" || device.pushToken === null) {
        return false;
      }
      yield* enqueue(
        {
          kind: "info",
          threadId: null,
          title: "CodeForge push test",
          body: "Background push delivery is configured for this device.",
          createdAt: new Date().toISOString(),
        },
        deviceId,
      );
      return true;
    });

  return { enqueue, getStatus, sendTest } satisfies PushDeliveryShape;
});

export const PushDeliveryLive = Layer.scoped(PushDeliveryService, makePushDelivery);
