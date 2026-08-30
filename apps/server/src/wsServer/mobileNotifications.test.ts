import { describe, expect, it } from "vitest";
import type { OrchestrationEvent } from "@codeforge/contracts";

import { mobileNotificationFromEvent } from "./mobileNotifications.ts";

const baseEvent = {
  sequence: 1,
  eventId: "event-1",
  aggregateKind: "thread",
  aggregateId: "thread-1",
  occurredAt: "2026-08-31T00:00:00.000Z",
  commandId: null,
  causationEventId: null,
  correlationId: null,
  metadata: {},
} as const;

describe("mobileNotificationFromEvent", () => {
  it("normalizes approval requests", () => {
    const event = {
      ...baseEvent,
      type: "thread.activity-appended",
      payload: {
        threadId: "thread-1",
        activity: {
          id: "activity-1",
          tone: "approval",
          kind: "approval.requested",
          summary: "Allow shell command?",
          payload: {},
          turnId: null,
          createdAt: "2026-08-31T00:00:01.000Z",
        },
      },
    } as unknown as OrchestrationEvent;

    expect(mobileNotificationFromEvent(event)).toEqual({
      kind: "approval",
      threadId: "thread-1",
      title: "Approval required",
      body: "Allow shell command?",
      createdAt: "2026-08-31T00:00:01.000Z",
    });
  });

  it("normalizes user-input requests", () => {
    const event = {
      ...baseEvent,
      type: "thread.activity-appended",
      payload: {
        threadId: "thread-1",
        activity: {
          id: "activity-2",
          tone: "info",
          kind: "user-input.requested",
          summary: "Choose a deployment target",
          payload: {},
          turnId: null,
          createdAt: "2026-08-31T00:00:02.000Z",
        },
      },
    } as unknown as OrchestrationEvent;

    expect(mobileNotificationFromEvent(event)?.kind).toBe("input");
  });

  it("uses durable turn-diff completion as the completion signal", () => {
    const event = {
      ...baseEvent,
      type: "thread.turn-diff-completed",
      payload: {
        threadId: "thread-1",
        turnId: "turn-1",
        checkpointTurnCount: 1,
        checkpointRef: "checkpoint-1",
        status: "ready",
        files: [],
        assistantMessageId: null,
        completedAt: "2026-08-31T00:00:03.000Z",
      },
    } as unknown as OrchestrationEvent;

    expect(mobileNotificationFromEvent(event)).toMatchObject({
      kind: "complete",
      threadId: "thread-1",
      createdAt: "2026-08-31T00:00:03.000Z",
    });
  });

  it("ignores unrelated orchestration events", () => {
    const event = {
      ...baseEvent,
      type: "thread.meta-updated",
      payload: {
        threadId: "thread-1",
        title: "Renamed",
        updatedAt: "2026-08-31T00:00:04.000Z",
      },
    } as unknown as OrchestrationEvent;

    expect(mobileNotificationFromEvent(event)).toBeNull();
  });
});
