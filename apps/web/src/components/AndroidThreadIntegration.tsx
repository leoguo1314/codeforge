import type { ThreadId } from "@codeforge/contracts";
import { useEffect, useMemo, useRef } from "react";

import {
  consumePendingAndroidSharedText,
  isAndroidApp,
  notifyAndroid,
  onAndroidSharedText,
} from "../androidBridge";
import { useComposerDraftStore, useComposerThreadDraft } from "../composerDraftStore";
import {
  derivePendingApprovals,
  derivePendingUserInputs,
  isLatestTurnSettled,
} from "../session-logic";
import { useStore } from "../store";

type NotificationSnapshot = {
  approvalCount: number;
  inputCount: number;
  latestTurnId: string | null;
  latestTurnSettled: boolean;
};

export function AndroidThreadIntegration({ threadId }: { threadId: ThreadId }) {
  const thread = useStore((store) => store.threads.find((candidate) => candidate.id === threadId));
  const composerDraft = useComposerThreadDraft(threadId);
  const setPrompt = useComposerDraftStore((store) => store.setPrompt);
  const promptRef = useRef(composerDraft.prompt);
  promptRef.current = composerDraft.prompt;

  const activities = thread?.activities ?? [];
  const approvalCount = useMemo(() => derivePendingApprovals(activities).length, [activities]);
  const inputCount = useMemo(() => derivePendingUserInputs(activities).length, [activities]);
  const latestTurnId = thread?.latestTurn?.turnId ?? null;
  const latestTurnSettled = isLatestTurnSettled(thread?.latestTurn ?? null, thread?.session ?? null);
  const threadTitle = thread?.title?.trim() || "CodeForge thread";

  useEffect(() => {
    if (!isAndroidApp()) return;

    const appendSharedText = (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const existing = promptRef.current.trimEnd();
      const nextPrompt = existing.length > 0 ? `${existing}\n\n${trimmed}` : trimmed;
      promptRef.current = nextPrompt;
      setPrompt(threadId, nextPrompt);
    };

    const drainPendingShares = () => {
      for (const text of consumePendingAndroidSharedText()) {
        appendSharedText(text);
      }
    };

    drainPendingShares();
    return onAndroidSharedText(() => drainPendingShares());
  }, [setPrompt, threadId]);

  const previousSnapshotRef = useRef<NotificationSnapshot | null>(null);
  useEffect(() => {
    if (!isAndroidApp()) return;

    const nextSnapshot: NotificationSnapshot = {
      approvalCount,
      inputCount,
      latestTurnId,
      latestTurnSettled,
    };
    const previous = previousSnapshotRef.current;
    previousSnapshotRef.current = nextSnapshot;

    // Do not notify for historical state when opening an existing thread.
    if (!previous) return;

    if (previous.approvalCount === 0 && approvalCount > 0) {
      notifyAndroid("approval", "Approval required", threadTitle);
    }

    if (previous.inputCount === 0 && inputCount > 0) {
      notifyAndroid("input", "Agent needs your input", threadTitle);
    }

    const sameTurn = previous.latestTurnId !== null && previous.latestTurnId === latestTurnId;
    if (sameTurn && !previous.latestTurnSettled && latestTurnSettled) {
      notifyAndroid("complete", "Agent turn completed", threadTitle);
    }
  }, [approvalCount, inputCount, latestTurnId, latestTurnSettled, threadTitle]);

  return null;
}
