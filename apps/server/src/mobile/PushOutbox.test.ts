import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";

import * as SqliteClient from "../persistence/NodeSqliteClient.ts";
import Migration0022 from "../persistence/Migrations/022_MobilePushOutbox.ts";
import { PushOutboxLive } from "./Layers/PushOutbox.ts";
import { PushOutbox } from "./Services/PushOutbox.ts";

const sqliteLayer = SqliteClient.layerMemory();
const outboxLayer = PushOutboxLive.pipe(Layer.provide(sqliteLayer));
const testLayer = Layer.merge(sqliteLayer, outboxLayer);

describe("PushOutbox", () => {
  it("persists, observes, retries, replays, and completes canonical notifications", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* Migration0022;
        const outbox = yield* PushOutbox;
        const now = new Date().toISOString();
        const notification = {
          kind: "info" as const,
          threadId: null,
          title: "CodeForge outbox test",
          body: "durable delivery",
          createdAt: now,
        };

        const deliveryId = yield* outbox.enqueue("device-test", notification);
        const deadDeliveryId = yield* outbox.enqueue("device-dead", {
          ...notification,
          title: "dead letter",
        });
        expect(yield* outbox.stats()).toEqual({
          pending: 2,
          retry: 0,
          dead: 0,
          delivered: 0,
        });

        const firstDue = yield* outbox.listDue(new Date(Date.now() + 1_000).toISOString(), 10);
        expect(firstDue).toHaveLength(2);
        expect(firstDue.find((item) => item.deliveryId === deliveryId)?.attemptCount).toBe(0);

        const retryAt = new Date(Date.now() + 60_000).toISOString();
        yield* outbox.markRetry(deliveryId, 1, retryAt, "temporary failure");
        yield* outbox.markDead(deadDeliveryId, 6, "permanent failure");
        expect(yield* outbox.stats()).toEqual({
          pending: 0,
          retry: 1,
          dead: 1,
          delivered: 0,
        });

        expect(yield* outbox.replayDead("missing-delivery")).toBe(false);
        expect(yield* outbox.replayDead(deadDeliveryId)).toBe(true);
        expect(yield* outbox.stats()).toEqual({
          pending: 0,
          retry: 2,
          dead: 0,
          delivered: 0,
        });

        const replayDue = yield* outbox.listDue(new Date(Date.now() + 2_000).toISOString(), 10);
        expect(replayDue.some((item) => item.deliveryId === deadDeliveryId)).toBe(true);
        expect(replayDue.find((item) => item.deliveryId === deadDeliveryId)?.attemptCount).toBe(0);

        const retryDue = yield* outbox.listDue(new Date(Date.now() + 120_000).toISOString(), 10);
        expect(retryDue.some((item) => item.deliveryId === deliveryId)).toBe(true);
        expect(retryDue.find((item) => item.deliveryId === deliveryId)?.attemptCount).toBe(1);

        yield* outbox.markDelivered(deliveryId, new Date().toISOString());
        yield* outbox.markDelivered(deadDeliveryId, new Date().toISOString());
        expect(yield* outbox.stats()).toEqual({
          pending: 0,
          retry: 0,
          dead: 0,
          delivered: 2,
        });
        const afterDelivery = yield* outbox.listDue(
          new Date(Date.now() + 180_000).toISOString(),
          10,
        );
        expect(afterDelivery).toHaveLength(0);
      }).pipe(Effect.provide(testLayer), Effect.scoped),
    );
  });
});
