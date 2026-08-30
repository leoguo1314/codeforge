import type { MobileNotificationPayload, OrchestrationEvent } from "@codeforge/contracts";

/**
 * Collapse the orchestration vocabulary into the three mobile attention events
 * a push transport actually needs. This stays transport-neutral: FCM, Huawei
 * Push Kit, APNs relays, or an enterprise push gateway can consume the same
 * MobileNotificationPayload later without learning provider/runtime details.
 */
export function mobileNotificationFromEvent(
  event: OrchestrationEvent,
): MobileNotificationPayload | null {
  if (event.type === "thread.activity-appended") {
    const activity = event.payload.activity;
    if (activity.kind === "approval.requested") {
      return {
        kind: "approval",
        threadId: event.payload.threadId,
        title: "Approval required",
        body: activity.summary || "A CodeForge agent is waiting for approval.",
        createdAt: activity.createdAt,
      };
    }

    if (activity.kind === "user-input.requested") {
      return {
        kind: "input",
        threadId: event.payload.threadId,
        title: "Agent needs your input",
        body: activity.summary || "A CodeForge agent is waiting for your input.",
        createdAt: activity.createdAt,
      };
    }
  }

  // Turn-diff completion is a durable post-turn fact and avoids false-positive
  // notifications from transient provider/session "ready" states.
  if (event.type === "thread.turn-diff-completed") {
    return {
      kind: "complete",
      threadId: event.payload.threadId,
      title: "Agent turn completed",
      body: "The CodeForge agent finished its current turn.",
      createdAt: event.payload.completedAt,
    };
  }

  return null;
}
