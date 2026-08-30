import type {
  MobileNotificationPayload,
  MobilePushServerStatus,
} from "@codeforge/contracts";
import { Effect, ServiceMap } from "effect";

import type { MobileDeviceRegistryError } from "./MobileDeviceRegistry.ts";

export interface PushDeliveryShape {
  /** Queue a canonical mobile notification without blocking orchestration. */
  readonly enqueue: (
    notification: MobileNotificationPayload,
    targetDeviceId?: string,
  ) => Effect.Effect<void>;
  readonly getStatus: () => Effect.Effect<MobilePushServerStatus, MobileDeviceRegistryError>;
  readonly sendTest: (deviceId: string) => Effect.Effect<boolean, MobileDeviceRegistryError>;
}

export class PushDeliveryService extends ServiceMap.Service<PushDeliveryService, PushDeliveryShape>()(
  "codeforge/mobile/PushDeliveryService",
) {}
