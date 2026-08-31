import type { MobilePushOutboxEntry, MobilePushOutboxStatusFilter } from "@codeforge/contracts";
import { DatabaseIcon, RefreshCwIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { isAndroidApp } from "../androidBridge";
import { ensureNativeApi } from "../nativeApi";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";

const FILTERS: readonly MobilePushOutboxStatusFilter[] = [
  "all",
  "pending",
  "retry",
  "dead",
  "delivered",
];

const formatTime = (value: string | null): string => {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
};

const cutoffIso = (days: number): string =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

export function MobilePushOpsLauncher() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<MobilePushOutboxStatusFilter>("dead");
  const [entries, setEntries] = useState<ReadonlyArray<MobilePushOutboxEntry>>([]);
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (isAndroidApp()) return null;

  const refresh = async (nextFilter = filter) => {
    setLoading(true);
    setMessage(null);
    try {
      const result = await ensureNativeApi().mobile.listPushOutbox({
        status: nextFilter,
        limit: 50,
      });
      setEntries(result.entries);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not load push outbox.");
    } finally {
      setLoading(false);
    }
  };

  const replay = async (deliveryId: string) => {
    setActionId(deliveryId);
    setMessage(null);
    try {
      const result = await ensureNativeApi().mobile.replayDeadPush({ deliveryId });
      setMessage(result.replayed ? "Dead-letter delivery queued for replay." : "Delivery is no longer dead.");
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not replay delivery.");
    } finally {
      setActionId(null);
    }
  };

  const purge = async (kind: "delivered" | "dead") => {
    const days = kind === "delivered" ? 7 : 30;
    const confirmed = await ensureNativeApi().dialogs.confirm(
      `Delete ${kind} push records older than ${days} days? This cannot be undone.`,
    );
    if (!confirmed) return;

    setActionId(`purge:${kind}`);
    setMessage(null);
    try {
      const result = await ensureNativeApi().mobile.purgePushOutbox({
        deliveredBefore: kind === "delivered" ? cutoffIso(days) : null,
        deadBefore: kind === "dead" ? cutoffIso(days) : null,
      });
      setMessage(`Deleted ${result.deleted} ${kind} push record${result.deleted === 1 ? "" : "s"}.`);
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not clean push outbox.");
    } finally {
      setActionId(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) void refresh();
        if (!nextOpen) setMessage(null);
      }}
    >
      <DialogTrigger
        render={
          <Button
            size="xs"
            variant="outline"
            className="fixed right-3 top-24 z-40 shadow-md sm:right-4"
            aria-label="Mobile push operations"
          />
        }
      >
        <DatabaseIcon />
        <span className="hidden sm:inline">Push Ops</span>
      </DialogTrigger>
      <DialogPopup className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Mobile Push Outbox</DialogTitle>
          <DialogDescription>
            Inspect durable push delivery state, replay dead letters, and clean terminal records.
            Pending and retry rows are never removed by retention actions.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.map((status) => (
              <Button
                key={status}
                size="xs"
                variant={filter === status ? "default" : "outline"}
                onClick={() => {
                  setFilter(status);
                  void refresh(status);
                }}
              >
                {status}
              </Button>
            ))}
            <Button size="xs" variant="ghost" onClick={() => void refresh()} disabled={loading}>
              <RefreshCwIcon className={loading ? "animate-spin" : ""} />
              Refresh
            </Button>
          </div>

          <div className="max-h-[55vh] space-y-2 overflow-auto pr-1">
            {!loading && entries.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                No {filter === "all" ? "" : `${filter} `}push deliveries.
              </div>
            ) : null}
            {entries.map((entry) => (
              <div key={entry.deliveryId} className="rounded-lg border bg-card p-3 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded border px-1.5 py-0.5 font-medium uppercase tracking-wide">
                        {entry.status}
                      </span>
                      <span className="font-medium text-foreground">{entry.title}</span>
                      <span className="text-muted-foreground">attempt {entry.attemptCount}</span>
                    </div>
                    <div className="mt-1 line-clamp-2 text-muted-foreground">{entry.body}</div>
                    <div className="mt-2 grid gap-1 font-mono text-[10px] text-muted-foreground sm:grid-cols-2">
                      <div>delivery: {entry.deliveryId}</div>
                      <div>device: {entry.deviceId}</div>
                      <div>updated: {formatTime(entry.updatedAt)}</div>
                      <div>next: {formatTime(entry.nextAttemptAt)}</div>
                    </div>
                    {entry.lastError ? (
                      <div className="mt-2 rounded border border-destructive/20 bg-destructive/5 p-2 font-mono text-[10px] text-destructive break-all">
                        {entry.lastError}
                      </div>
                    ) : null}
                  </div>
                  {entry.status === "dead" ? (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => void replay(entry.deliveryId)}
                      disabled={actionId === entry.deliveryId}
                    >
                      <RotateCcwIcon className={actionId === entry.deliveryId ? "animate-spin" : ""} />
                      Replay
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          {message ? (
            <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">{message}</div>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => void purge("delivered")}
            disabled={actionId !== null}
          >
            <Trash2Icon />
            Delivered &gt;7d
          </Button>
          <Button
            variant="outline"
            onClick={() => void purge("dead")}
            disabled={actionId !== null}
          >
            <Trash2Icon />
            Dead &gt;30d
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
