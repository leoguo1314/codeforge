import { CheckIcon, CopyIcon, SmartphoneIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { isAndroidApp } from "../androidBridge";
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

const initialAuthToken = (): string => {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("token") ?? "";
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

export function PairAndroidLauncher() {
  const [open, setOpen] = useState(false);
  const [serverUrl, setServerUrl] = useState(initialServerUrl);
  const [authToken, setAuthToken] = useState(initialAuthToken);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  const normalizedServerUrl = useMemo(() => normalizeServerUrl(serverUrl), [serverUrl]);
  const pairingLink = useMemo(() => {
    if (!normalizedServerUrl) return "";
    const url = new URL("codeforge://connect");
    url.searchParams.set("server", normalizedServerUrl);
    if (authToken.trim()) {
      url.searchParams.set("token", authToken.trim());
    }
    return url.toString();
  }, [authToken, normalizedServerUrl]);

  if (isAndroidApp()) return null;

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
            Create a CodeForge Android deep link locally. Nothing in this dialog is sent to a
            third-party QR or pairing service.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-foreground">Server URL</span>
            <input
              value={serverUrl}
              onChange={(event) => {
                setServerUrl(event.target.value);
                setCopyState("idle");
              }}
              placeholder="https://codeforge.example.com"
              inputMode="url"
              className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            />
            {!normalizedServerUrl && serverUrl.trim() ? (
              <span className="text-xs text-destructive">Enter an HTTP or HTTPS server URL.</span>
            ) : null}
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-foreground">WebSocket auth token</span>
            <input
              value={authToken}
              onChange={(event) => {
                setAuthToken(event.target.value);
                setCopyState("idle");
              }}
              placeholder="Paste the token used by --auth-token"
              type="password"
              autoComplete="off"
              className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            />
          </label>

          <div className="space-y-1.5">
            <span className="text-xs font-medium text-foreground">Pairing link</span>
            <div className="max-h-28 overflow-auto rounded-lg border bg-muted/35 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground break-all">
              {pairingLink || "Enter a valid server URL to generate the pairing link."}
            </div>
          </div>

          <div className="rounded-lg border border-amber-500/25 bg-amber-500/8 p-3 text-xs leading-relaxed text-muted-foreground">
            Treat this link as a credential when it contains a token. Do not paste it into public QR
            generators, logs, issues, or chat rooms. v0.3 intentionally keeps generation local; a
            built-in offline QR renderer will replace manual QR encoding in a later increment.
          </div>
        </DialogPanel>
        <DialogFooter>
          {copyState === "error" ? (
            <span className="mr-auto self-center text-xs text-destructive">
              Clipboard unavailable. Select and copy the link manually.
            </span>
          ) : null}
          <Button onClick={() => void handleCopy()} disabled={!pairingLink}>
            {copyState === "copied" ? <CheckIcon /> : <CopyIcon />}
            {copyState === "copied" ? "Copied" : "Copy pairing link"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
