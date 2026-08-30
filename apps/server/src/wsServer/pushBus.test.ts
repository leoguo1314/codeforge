import type { WebSocket } from "ws";
import { describe, expect, it } from "vitest";
import { Effect, Ref } from "effect";
import {
  ORCHESTRATION_WS_CHANNELS,
  WS_CHANNELS,
  type OrchestrationEvent,
} from "@codeforge/contracts";

import { makeServerPushBus } from "./pushBus";

class MockWebSocket {
  static readonly OPEN = 1;

  readonly OPEN = MockWebSocket.OPEN;
  readyState = MockWebSocket.OPEN;
  readonly sent: string[] = [];
  private readonly waiters = new Set<() => void>();

  send(message: string) {
    this.sent.push(message);
    for (const waiter of this.waiters) waiter();
  }

  waitForSentCount(count: number): Promise<void> {
    if (this.sent.length >= count) return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => {
        if (this.sent.length < count) return;
        this.waiters.delete(check);
        resolve();
      };
      this.waiters.add(check);
    });
  }
}

const runScoped = <A, E>(effect: Effect.Effect<A, E, never>) =>
  Effect.runPromise(Effect.scoped(effect as Effect.Effect<A, E, never>));

describe("makeServerPushBus", () => {
  it("waits for the welcome push before a new client joins broadcast delivery", async () => {
    await runScoped(
      Effect.gen(function* () {
        const client = new MockWebSocket();
        const clients = yield* Ref.make(new Set<WebSocket>());
        const pushBus = yield* makeServerPushBus({
          clients,
          logOutgoingPush: () => {},
        });

        yield* pushBus.publishAll(WS_CHANNELS.serverConfigUpdated, {
          issues: [{ kind: "keybindings.malformed-config", message: "queued-before-connect" }],
        });

        const delivered = yield* pushBus.publishClient(
          client as unknown as WebSocket,
          WS_CHANNELS.serverWelcome,
          {
            cwd: "/tmp/project",
            projectName: "project",
          },
        );
        expect(delivered).toBe(true);

        yield* Ref.update(clients, (current) => current.add(client as unknown as WebSocket));
        yield* pushBus.publishAll(WS_CHANNELS.serverConfigUpdated, { issues: [] });
        yield* Effect.promise(() => client.waitForSentCount(2));

        const messages = client.sent.map(
          (message) => JSON.parse(message) as { channel: string; data: unknown },
        );

        expect(messages).toHaveLength(2);
        expect(messages[0]).toEqual({
          type: "push",
          sequence: 2,
          channel: WS_CHANNELS.serverWelcome,
          data: {
            cwd: "/tmp/project",
            projectName: "project",
          },
        });
        expect(messages[1]).toEqual({
          type: "push",
          sequence: 3,
          channel: WS_CHANNELS.serverConfigUpdated,
          data: { issues: [] },
        });
      }),
    );
  });

  it("fans durable turn completion into a normalized mobile notification", async () => {
    await runScoped(
      Effect.gen(function* () {
        const client = new MockWebSocket();
        const clients = yield* Ref.make(new Set<WebSocket>([client as unknown as WebSocket]));
        const pushBus = yield* makeServerPushBus({
          clients,
          logOutgoingPush: () => {},
        });

        const event = {
          sequence: 42,
          eventId: "event-mobile-complete",
          aggregateKind: "thread",
          aggregateId: "thread-mobile",
          occurredAt: "2026-08-31T00:00:03.000Z",
          commandId: null,
          causationEventId: null,
          correlationId: null,
          metadata: {},
          type: "thread.turn-diff-completed",
          payload: {
            threadId: "thread-mobile",
            turnId: "turn-mobile",
            checkpointTurnCount: 1,
            checkpointRef: "checkpoint-mobile",
            status: "ready",
            files: [],
            assistantMessageId: null,
            completedAt: "2026-08-31T00:00:03.000Z",
          },
        } as OrchestrationEvent;

        yield* pushBus.publishAll(ORCHESTRATION_WS_CHANNELS.domainEvent, event);
        yield* Effect.promise(() => client.waitForSentCount(2));

        const messages = client.sent.map(
          (message) =>
            JSON.parse(message) as {
              channel: string;
              data: Record<string, unknown>;
            },
        );

        expect(messages.map((message) => message.channel)).toEqual([
          ORCHESTRATION_WS_CHANNELS.domainEvent,
          WS_CHANNELS.mobileNotification,
        ]);
        expect(messages[1]?.data).toMatchObject({
          kind: "complete",
          threadId: "thread-mobile",
          title: "Agent turn completed",
          createdAt: "2026-08-31T00:00:03.000Z",
        });
      }),
    );
  });
});
