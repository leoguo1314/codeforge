import {
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type ThreadId,
} from "@codeforge/contracts";
import { useEffect, useMemo, useRef } from "react";

import {
  type AndroidSharedImage,
  type AndroidSharedPayload,
  consumePendingAndroidShares,
  isAndroidApp,
  notifyAndroid,
  onAndroidShare,
} from "../androidBridge";
import {
  type ComposerImageAttachment,
  useComposerDraftStore,
  useComposerThreadDraft,
} from "../composerDraftStore";
import { randomUUID } from "../lib/utils";
import {
  derivePendingApprovals,
  derivePendingUserInputs,
  isLatestTurnSettled,
} from "../session-logic";
import { useStore } from "../store";
import { toastManager } from "./ui/toast";

type NotificationSnapshot = {
  approvalCount: number;
  inputCount: number;
  latestTurnId: string | null;
  latestTurnSettled: boolean;
};

const dataUrlToFile = (dataUrl: string, name: string, mimeType: string): File => {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex <= 0 || !dataUrl.slice(0, commaIndex).includes(";base64")) {
    throw new Error("Android shared image is not base64 encoded.");
  }

  const binary = window.atob(dataUrl.slice(commaIndex + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], name, { type: mimeType });
};

const toComposerAttachment = (sharedImage: AndroidSharedImage): ComposerImageAttachment => {
  const file = dataUrlToFile(sharedImage.dataUrl, sharedImage.name, sharedImage.mimeType);
  if (!file.type.startsWith("image/")) {
    throw new Error("Android shared attachment is not an image.");
  }
  if (file.size > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
    throw new Error("Android shared image exceeds the CodeForge attachment size limit.");
  }

  return {
    type: "image",
    id: randomUUID(),
    name: file.name || "image",
    mimeType: file.type,
    sizeBytes: file.size,
    previewUrl: URL.createObjectURL(file),
    file,
  };
};

export function AndroidThreadIntegration({ threadId }: { threadId: ThreadId }) {
  const thread = useStore((store) => store.threads.find((candidate) => candidate.id === threadId));
  const composerDraft = useComposerThreadDraft(threadId);
  const setPrompt = useComposerDraftStore((store) => store.setPrompt);
  const addImage = useComposerDraftStore((store) => store.addImage);
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

    const applySharedPayload = (payload: AndroidSharedPayload) => {
      if (payload.kind === "text") {
        appendSharedText(payload.text);
        return;
      }

      if (inputCount > 0) {
        toastManager.add({
          type: "warning",
          title: "Finish the pending agent questions first",
          description: "The shared image was not attached.",
        });
        return;
      }

      const sharedImages = payload.kind === "images" ? payload.images : [payload];
      try {
        const currentImages =
          useComposerDraftStore.getState().draftsByThreadId[threadId]?.images ?? [];
        if (currentImages.length + sharedImages.length > PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
          throw new Error(
            `This share contains ${sharedImages.length} image${sharedImages.length === 1 ? "" : "s"}, but only ${Math.max(0, PROVIDER_SEND_TURN_MAX_ATTACHMENTS - currentImages.length)} attachment slot${PROVIDER_SEND_TURN_MAX_ATTACHMENTS - currentImages.length === 1 ? " is" : "s are"} available.`,
          );
        }

        const attachments = sharedImages.map(toComposerAttachment);
        for (const image of attachments) addImage(threadId, image);
        if (payload.text) appendSharedText(payload.text);
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Could not attach Android shared image",
          description: error instanceof Error ? error.message : "Invalid shared image payload.",
        });
      }
    };

    const drainPendingShares = () => {
      for (const payload of consumePendingAndroidShares()) {
        applySharedPayload(payload);
      }
    };

    drainPendingShares();
    return onAndroidShare(() => drainPendingShares());
  }, [addImage, inputCount, setPrompt, threadId]);

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
