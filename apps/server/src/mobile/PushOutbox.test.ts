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
  it("persists, retries, and completes a canonical notification", async () => {
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
        const firstDue = yield* outbox.listDue(new Date(Date.now() + 1_000).toISOString(), 10);
        expect(firstDue).toHaveLength(1);
        expect(firstDue[0]?.deliveryId).toBe(deliveryId);
        expect(firstDue[0]?.attemptCount).toBe(0);
        expect(firstDue[0]?.notification.title).toBe(notification.title);

        const retryAt = new Date(Date.now() + 60_000).toISOString();
        yield* outbox.markRetry(deliveryId, 1, retryAt, "temporary failure");
        const beforeRetry = yield* outbox.listDue(new Date(Date.now() + 2_000).toISOString(), 10);
        expect(beforeRetry).toHaveLength(0);

        const retryDue = yield* outbox.listDue(new Date(Date.now() + 120_000).toISOString(), 10);
        expect(retryDue).toHaveLength(1);
        expect(retryDue[0]?.attemptCount).toBe(1);

        yield* outbox.markDelivered(deliveryId, new Date().toISOString());
        const afterDelivery = yield* outbox.listDue(
          new Date(Date.now() + 180_000).toISOString(),
          10,
        );
        expect(afterDelivery).toHaveLength(0);
      }).pipe(Effect.provide(testLayer), Effect.scoped),
    );
  });
});
