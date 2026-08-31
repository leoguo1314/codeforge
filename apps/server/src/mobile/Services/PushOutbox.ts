import type {
  MobileNotificationPayload,
  MobilePushOutboxEntry,
  MobilePushOutboxStats,
  MobilePushOutboxStatusFilter,
} from "@codeforge/contracts";
import { Effect, Schema, ServiceMap } from "effect";

export interface PushOutboxItem {
  readonly deliveryId: string;
  readonly deviceId: string;
  readonly notification: MobileNotificationPayload;
  readonly attemptCount: number;
}

export class PushOutboxError extends Schema.TaggedErrorClass<PushOutboxError>()("PushOutboxError", {
  operation: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export interface PushOutboxShape {
  readonly enqueue: (
    deviceId: string,
    notification: MobileNotificationPayload,
  ) => Effect.Effect<string, PushOutboxError>;
  readonly listDue: (
    now: string,
    limit: number,
  ) => Effect.Effect<ReadonlyArray<PushOutboxItem>, PushOutboxError>;
  readonly markDelivered: (
    deliveryId: string,
    deliveredAt: string,
  ) => Effect.Effect<void, PushOutboxError>;
  readonly markRetry: (
    deliveryId: string,
    attemptCount: number,
    nextAttemptAt: string,
    lastError: string,
  ) => Effect.Effect<void, PushOutboxError>;
  readonly markDead: (
    deliveryId: string,
    attemptCount: number,
    lastError: string,
  ) => Effect.Effect<void, PushOutboxError>;
  readonly stats: () => Effect.Effect<MobilePushOutboxStats, PushOutboxError>;
  readonly replayDead: (deliveryId: string) => Effect.Effect<boolean, PushOutboxError>;
  readonly list: (
    status: MobilePushOutboxStatusFilter,
    limit: number,
  ) => Effect.Effect<ReadonlyArray<MobilePushOutboxEntry>, PushOutboxError>;
  readonly purge: (input: {
    readonly deliveredBefore: string | null;
    readonly deadBefore: string | null;
  }) => Effect.Effect<number, PushOutboxError>;
}

export class PushOutbox extends ServiceMap.Service<PushOutbox, PushOutboxShape>()(
  "codeforge/mobile/PushOutbox",
) {}
