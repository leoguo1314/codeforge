import { CheckIcon, CopyIcon, RefreshCwIcon, SmartphoneIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { isAndroidApp } from "../androidBridge";
import { createQrMatrix, qrMatrixToPath } from "../lib/qrCode";
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

const initialServerUrl = (): string => {
  if (typeof window === "undefined") return "";
  return window.location.protocol === "http:" || window.location.protocol === "https:"
    ? window.location.origin
    : "";
};

const normalizeServerUrl = (value: string): string | null => {
  const candidate = value.trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
};

const copyText = async (value: string): Promise<void> => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard is unavailable.");
};

const remainingLabel = (expiresAt: string | null, now: number): string => {
  if (!expiresAt) return "";
  const remaining = Math.max(0, Date.parse(expiresAt) - now);
  if (remaining <= 0) return "Expired";
  const seconds = Math.ceil(remaining / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

export function PairAndroidLauncher() {
  const [open, setOpen] = useState(false);
  const [serverUrl, setServerUrl] = useState(initialServerUrl);
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [now, setNow] = useState(() => Date.now());

  const normalizedServerUrl = useMemo(() => normalizeServerUrl(serverUrl), [serverUrl]);
  const expired = expiresAt ? Date.parse(expiresAt) <= now : false;
  const pairingLink = useMemo(() => {
    if (!normalizedServerUrl || !pairCode || expired) return "";
    const url = new URL("codeforge://connect");
    url.searchParams.set("server", normalizedServerUrl);
    url.searchParams.set("pair", pairCode);
    return url.toString();
  }, [expired, normalizedServerUrl, pairCode]);

  const qrCode = useMemo(() => {
    if (!pairingLink) return { path: "", viewBoxSize: 0, error: null as string | null };
    try {
      const matrix = createQrMatrix(pairingLink);
      const rendered = qrMatrixToPath(matrix);
      return { ...rendered, error: null as string | null };
    } catch (cause) {
      return {
        path: "",
        viewBoxSize: 0,
        error: cause instanceof Error ? cause.message : "Could not generate QR code.",
      };
    }
  }, [pairingLink]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [open]);

  if (isAndroidApp()) return null;

  const generate = async () => {
    if (!normalizedServerUrl) {
      setError("Enter a valid HTTP or HTTPS server URL first.");
      return;
    }
    setLoading(true);
    setError(null);
    setCopyState("idle");
    try {
      const result = await ensureNativeApi().mobile.createPairingCode();
      setPairCode(result.code);
      setExpiresAt(result.expiresAt);
      setNow(Date.now());
    } catch (cause) {
      setPairCode(null);
      setExpiresAt(null);
      setError(cause instanceof Error ? cause.message : "Could not create a pairing code.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!pairingLink) return;
    try {
      await copyText(pairingLink);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      setCopyState("error");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen && !pairCode && !loading) void generate();
        if (!nextOpen) setCopyState("idle");
      }}
    >
      <DialogTrigger
        render={
          <Button
            size="xs"
            variant="outline"
            className="fixed right-3 top-14 z-40 shadow-md sm:right-4"
            aria-label="Pair Android"
          />
        }
      >
        <SmartphoneIcon />
        <span className="hidden sm:inline">Pair Android</span>
      </DialogTrigger>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Pair Android</DialogTitle>
          <DialogDescription>
            Generate a short-lived, single-use Android pairing code. The QR no longer contains the
            long-lived CodeForge server token.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-foreground">Server URL</span>
            <input
              value={serverUrl}
              onChange={(event) => {
                setServerUrl(event.target.value);
                setPairCode(null);
                setExpiresAt(null);
                setCopyState("idle");
                setError(null);
              }}
              placeholder="https://codeforge.example.com"
              inputMode="url"
              className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            />
            {!normalizedServerUrl && serverUrl.trim() ? (
              <span className="text-xs text-destructive">Enter an HTTP or HTTPS server URL.</span>
            ) : null}
          </label>

          <div className="flex items-center justify-between rounded-lg border bg-muted/25 px-3 py-2 text-xs">
            <div>
              <div className="font-medium text-foreground">One-time pairing code</div>
              <div className="font-mono text-muted-foreground">
                {pairCode ? `${pairCode.slice(0, 6)}…${pairCode.slice(-4)}` : "Not generated"}
              </div>
            </div>
            <div className={expired ? "font-medium text-destructive" : "text-muted-foreground"}>
              {expiresAt ? remainingLabel(expiresAt, now) : "2 min TTL"}
            </div>
          </div>

          {pairingLink && qrCode.path ? (
            <div className="flex justify-center rounded-xl border bg-white p-4">
              <svg
                aria-label="CodeForge Android one-time pairing QR code"
                className="size-56 max-w-full"
                role="img"
                shapeRendering="crispEdges"
                viewBox={`0 0 ${qrCode.viewBoxSize} ${qrCode.viewBoxSize}`}
              >
                <rect width="100%" height="100%" fill="white" />
                <path d={qrCode.path} fill="black" />
              </svg>
            </div>
          ) : qrCode.error ? (
            <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-xs text-destructive">
              {qrCode.error}
            </div>
          ) : null}

          {expired ? (
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/8 p-3 text-xs text-muted-foreground">
              This pairing code expired. Generate a new code before scanning.
            </div>
          ) : null}

          {error ? (
            <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-xs text-destructive">
              {error}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <span className="text-xs font-medium text-foreground">Pairing link</span>
            <div className="max-h-28 overflow-auto rounded-lg border bg-muted/35 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground break-all">
              {pairingLink || "Generate a valid one-time code to create the pairing link."}
            </div>
          </div>

          <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/8 p-3 text-xs leading-relaxed text-muted-foreground">
            The QR contains only the server address and a single-use code valid for about two
            minutes. Android redeems it for a device session; the administrator auth token never
            enters the QR or clipboard.
          </div>
        </DialogPanel>
        <DialogFooter>
          {copyState === "error" ? (
            <span className="mr-auto self-center text-xs text-destructive">
              Clipboard unavailable. Select and copy the link manually.
            </span>
          ) : null}
          <Button variant="outline" onClick={() => void generate()} disabled={loading || !normalizedServerUrl}>
            <RefreshCwIcon className={loading ? "animate-spin" : ""} />
            {pairCode ? "New code" : "Generate"}
          </Button>
          <Button onClick={() => void handleCopy()} disabled={!pairingLink}>
            {copyState === "copied" ? <CheckIcon /> : <CopyIcon />}
            {copyState === "copied" ? "Copied" : "Copy pairing link"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
