import {
  MobileNotificationPayload,
  MobilePushOutboxEntry,
  type MobilePushOutboxStats,
} from "@codeforge/contracts";
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
const AdminListRequest = Schema.Struct({ status: Schema.String, limit: Schema.Number });
const PurgeRequest = Schema.Struct({
  deliveredBefore: Schema.NullOr(Schema.String),
  deadBefore: Schema.NullOr(Schema.String),
});
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
const ReplayRequest = Schema.Struct({
  deliveryId: Schema.String,
  replayAt: Schema.String,
});
const OutboxRow = Schema.Struct({
  deliveryId: Schema.String,
  deviceId: Schema.String,
  notificationJson: Schema.String,
  attemptCount: Schema.Number,
});
const AdminRow = Schema.Struct({
  deliveryId: Schema.String,
  deviceId: Schema.String,
  notificationJson: Schema.String,
  status: Schema.String,
  attemptCount: Schema.Number,
  nextAttemptAt: Schema.String,
  lastError: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  deliveredAt: Schema.NullOr(Schema.String),
});
const DeletedRow = Schema.Struct({ deliveryId: Schema.String });
const StatusRow = Schema.Struct({ status: Schema.String });
const StatsRow = Schema.Struct({
  pending: Schema.Number,
  retry: Schema.Number,
  dead: Schema.Number,
  delivered: Schema.Number,
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

  const findAdminRows = SqlSchema.findAll({
    Request: AdminListRequest,
    Result: AdminRow,
    execute: ({ status, limit }) => sql`
      SELECT
        delivery_id AS "deliveryId",
        device_id AS "deviceId",
        notification_json AS "notificationJson",
        status,
        attempt_count AS "attemptCount",
        next_attempt_at AS "nextAttemptAt",
        last_error AS "lastError",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        delivered_at AS "deliveredAt"
      FROM mobile_push_outbox
      WHERE (${status} = 'all' OR status = ${status})
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `,
  });

  const purgeRows = SqlSchema.findAll({
    Request: PurgeRequest,
    Result: DeletedRow,
    execute: ({ deliveredBefore, deadBefore }) => sql`
      DELETE FROM mobile_push_outbox
      WHERE
        (${deliveredBefore} IS NOT NULL AND status = 'delivered' AND updated_at < ${deliveredBefore})
        OR
        (${deadBefore} IS NOT NULL AND status = 'dead' AND updated_at < ${deadBefore})
      RETURNING delivery_id AS "deliveryId"
    `,
  });

  const findStatusRows = SqlSchema.findAll({
    Request: DeliveryIdRequest,
    Result: StatusRow,
    execute: ({ deliveryId }) => sql`
      SELECT status
      FROM mobile_push_outbox
      WHERE delivery_id = ${deliveryId}
      LIMIT 1
    `,
  });

  const readStatsRows = SqlSchema.findAll({
    Request: Schema.Struct({}),
    Result: StatsRow,
    execute: () => sql`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
        COALESCE(SUM(CASE WHEN status = 'retry' THEN 1 ELSE 0 END), 0) AS retry,
        COALESCE(SUM(CASE WHEN status = 'dead' THEN 1 ELSE 0 END), 0) AS dead,
        COALESCE(SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END), 0) AS delivered
      FROM mobile_push_outbox
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

  const replayDeadRow = SqlSchema.void({
    Request: ReplayRequest,
    execute: ({ deliveryId, replayAt }) => sql`
      UPDATE mobile_push_outbox
      SET
        status = 'retry',
        attempt_count = 0,
        next_attempt_at = ${replayAt},
        last_error = NULL,
        delivered_at = NULL,
        updated_at = ${replayAt}
      WHERE delivery_id = ${deliveryId}
        AND status = 'dead'
    `,
  });

  const decodeNotification = (notificationJson: string, operation: string) =>
    Effect.try({
      try: () => JSON.parse(notificationJson) as unknown,
      catch: toOutboxError(`${operation}.parse`),
    }).pipe(
      Effect.flatMap((json) => Schema.decodeUnknownEffect(MobileNotificationPayload)(json)),
      Effect.mapError(toOutboxError(`${operation}.decode`)),
    );

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
          decodeNotification(row.notificationJson, "PushOutbox.listDue").pipe(
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

  const stats: PushOutboxShape["stats"] = () =>
    readStatsRows({}).pipe(
      Effect.mapError(toOutboxError("PushOutbox.stats")),
      Effect.map((rows): MobilePushOutboxStats => {
        const row = rows[0];
        return {
          pending: row?.pending ?? 0,
          retry: row?.retry ?? 0,
          dead: row?.dead ?? 0,
          delivered: row?.delivered ?? 0,
        };
      }),
    );

  const replayDead: PushOutboxShape["replayDead"] = (deliveryId) =>
    findStatusRows({ deliveryId }).pipe(
      Effect.mapError(toOutboxError("PushOutbox.replayDead.lookup")),
      Effect.flatMap((rows) => {
        if (rows[0]?.status !== "dead") return Effect.succeed(false);
        return replayDeadRow({ deliveryId, replayAt: new Date().toISOString() }).pipe(
          Effect.mapError(toOutboxError("PushOutbox.replayDead.update")),
          Effect.as(true),
        );
      }),
    );

  const list: PushOutboxShape["list"] = (status, limit) =>
    findAdminRows({ status, limit: Math.max(1, Math.min(limit, 200)) }).pipe(
      Effect.mapError(toOutboxError("PushOutbox.list.query")),
      Effect.flatMap((rows) =>
        Effect.forEach(rows, (row) =>
          decodeNotification(row.notificationJson, "PushOutbox.list").pipe(
            Effect.flatMap((notification) =>
              Schema.decodeUnknownEffect(MobilePushOutboxEntry)({
                deliveryId: row.deliveryId,
                deviceId: row.deviceId,
                status: row.status,
                attemptCount: row.attemptCount,
                nextAttemptAt: row.nextAttemptAt,
                lastError: row.lastError,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
                deliveredAt: row.deliveredAt,
                notificationKind: notification.kind,
                threadId: notification.threadId,
                title: notification.title,
                body: notification.body,
                notificationCreatedAt: notification.createdAt,
              }),
            ),
            Effect.mapError(toOutboxError("PushOutbox.list.entry")),
          ),
        ),
      ),
    );

  const purge: PushOutboxShape["purge"] = (input) =>
    purgeRows(input).pipe(
      Effect.mapError(toOutboxError("PushOutbox.purge")),
      Effect.map((rows) => rows.length),
    );

  return {
    enqueue,
    listDue,
    markDelivered,
    markRetry,
    markDead,
    stats,
    replayDead,
    list,
    purge,
  } satisfies PushOutboxShape;
});

export const PushOutboxLive = Layer.effect(PushOutbox, makePushOutbox);
