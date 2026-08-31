import { MobileNotificationPayload } from "@codeforge/contracts";
import { Effect, Layer, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  PushOutbox,
  PushOutboxError,
  type PushOutboxShape,
} from "../Services/PushOutbox.ts";

const DeliveryIdRequest = Schema.Struct({ deliveryId: Schema.String });
const DueRequest = Schema.Struct({ now: Schema.String, limit: Schema.Number });
const InsertRequest = Schema.Struct({
  deliveryId: Schema.String,
  deviceId: Schema.String,
  notificationJson: Schema.String,
  createdAt: Schema.String,
});
const RetryRequest = Schema.Struct({
  deliveryId: Schema.String,
  attemptCount: Schema.Number,
  nextAttemptAt: Schema.String,
  lastError: Schema.String,
  updatedAt: Schema.String,
});
const DeadRequest = Schema.Struct({
  deliveryId: Schema.String,
  attemptCount: Schema.Number,
  lastError: Schema.String,
  updatedAt: Schema.String,
});
const DeliveredRequest = Schema.Struct({
  deliveryId: Schema.String,
  deliveredAt: Schema.String,
});
const OutboxRow = Schema.Struct({
  deliveryId: Schema.String,
  deviceId: Schema.String,
  notificationJson: Schema.String,
  attemptCount: Schema.Number,
});

const toOutboxError = (operation: string) => (cause: unknown) =>
  new PushOutboxError({ operation, cause });

const makePushOutbox = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const insertRow = SqlSchema.void({
    Request: InsertRequest,
    execute: ({ deliveryId, deviceId, notificationJson, createdAt }) => sql`
      INSERT INTO mobile_push_outbox (
        delivery_id,
        device_id,
        notification_json,
        status,
        attempt_count,
        next_attempt_at,
        created_at,
        updated_at
      )
      VALUES (
        ${deliveryId},
        ${deviceId},
        ${notificationJson},
        'pending',
        0,
        ${createdAt},
        ${createdAt},
        ${createdAt}
      )
    `,
  });

  const findDueRows = SqlSchema.findAll({
    Request: DueRequest,
    Result: OutboxRow,
    execute: ({ now, limit }) => sql`
      SELECT
        delivery_id AS "deliveryId",
        device_id AS "deviceId",
        notification_json AS "notificationJson",
        attempt_count AS "attemptCount"
      FROM mobile_push_outbox
      WHERE status IN ('pending', 'retry')
        AND next_attempt_at <= ${now}
      ORDER BY next_attempt_at ASC, created_at ASC
      LIMIT ${limit}
    `,
  });

  const markDeliveredRow = SqlSchema.void({
    Request: DeliveredRequest,
    execute: ({ deliveryId, deliveredAt }) => sql`
      UPDATE mobile_push_outbox
      SET
        status = 'delivered',
        delivered_at = ${deliveredAt},
        updated_at = ${deliveredAt},
        last_error = NULL
      WHERE delivery_id = ${deliveryId}
    `,
  });

  const markRetryRow = SqlSchema.void({
    Request: RetryRequest,
    execute: ({ deliveryId, attemptCount, nextAttemptAt, lastError, updatedAt }) => sql`
      UPDATE mobile_push_outbox
      SET
        status = 'retry',
        attempt_count = ${attemptCount},
        next_attempt_at = ${nextAttemptAt},
        last_error = ${lastError},
        updated_at = ${updatedAt}
      WHERE delivery_id = ${deliveryId}
    `,
  });

  const markDeadRow = SqlSchema.void({
    Request: DeadRequest,
    execute: ({ deliveryId, attemptCount, lastError, updatedAt }) => sql`
      UPDATE mobile_push_outbox
      SET
        status = 'dead',
        attempt_count = ${attemptCount},
        last_error = ${lastError},
        updated_at = ${updatedAt}
      WHERE delivery_id = ${deliveryId}
    `,
  });

  const enqueue: PushOutboxShape["enqueue"] = (deviceId, notification) =>
    Effect.gen(function* () {
      const deliveryId = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      yield* insertRow({
        deliveryId,
        deviceId,
        notificationJson: JSON.stringify(notification),
        createdAt,
      }).pipe(Effect.mapError(toOutboxError("PushOutbox.enqueue")));
      return deliveryId;
    });

  const listDue: PushOutboxShape["listDue"] = (now, limit) =>
    findDueRows({ now, limit }).pipe(
      Effect.mapError(toOutboxError("PushOutbox.listDue.query")),
      Effect.flatMap((rows) =>
        Effect.forEach(rows, (row) =>
          Effect.try({
            try: () => JSON.parse(row.notificationJson) as unknown,
            catch: toOutboxError("PushOutbox.listDue.parse"),
          }).pipe(
            Effect.flatMap((json) => Schema.decodeUnknownEffect(MobileNotificationPayload)(json)),
            Effect.mapError(toOutboxError("PushOutbox.listDue.decode")),
            Effect.map((notification) => ({
              deliveryId: row.deliveryId,
              deviceId: row.deviceId,
              notification,
              attemptCount: row.attemptCount,
            })),
          ),
        ),
      ),
    );

  const markDelivered: PushOutboxShape["markDelivered"] = (deliveryId, deliveredAt) =>
    markDeliveredRow({ deliveryId, deliveredAt }).pipe(
      Effect.mapError(toOutboxError("PushOutbox.markDelivered")),
    );

  const markRetry: PushOutboxShape["markRetry"] = (
    deliveryId,
    attemptCount,
    nextAttemptAt,
    lastError,
  ) =>
    markRetryRow({
      deliveryId,
      attemptCount,
      nextAttemptAt,
      lastError,
      updatedAt: new Date().toISOString(),
    }).pipe(Effect.mapError(toOutboxError("PushOutbox.markRetry")));

  const markDead: PushOutboxShape["markDead"] = (deliveryId, attemptCount, lastError) =>
    markDeadRow({
      deliveryId,
      attemptCount,
      lastError,
      updatedAt: new Date().toISOString(),
    }).pipe(Effect.mapError(toOutboxError("PushOutbox.markDead")));

  return { enqueue, listDue, markDelivered, markRetry, markDead } satisfies PushOutboxShape;
});

export const PushOutboxLive = Layer.effect(PushOutbox, makePushOutbox);
