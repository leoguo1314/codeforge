const ANDROID_SHARE_EVENT = "codeforge:android-share";

export type AndroidNotificationKind = "approval" | "complete" | "input" | "info";

type AndroidJavascriptBridge = {
  notify?: (kind: AndroidNotificationKind, title: string, body: string) => void;
};

declare global {
  interface Window {
    CodeForgeAndroid?: AndroidJavascriptBridge;
    __codeforgePendingAndroidSharedText?: string[];
    __codeforgeReceiveSharedText?: (text: string) => void;
  }
}

function normalizeSharedText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

export function isAndroidApp(): boolean {
  return typeof window !== "undefined" && typeof window.CodeForgeAndroid === "object";
}

export function installAndroidBridge(): void {
  if (typeof window === "undefined") return;

  if (isAndroidApp()) {
    document.documentElement.classList.add("codeforge-android");
  }

  window.__codeforgePendingAndroidSharedText ??= [];
  window.__codeforgeReceiveSharedText = (rawText: string) => {
    const text = normalizeSharedText(rawText);
    if (!text) return;

    window.__codeforgePendingAndroidSharedText?.push(text);
    window.dispatchEvent(new CustomEvent<string>(ANDROID_SHARE_EVENT, { detail: text }));
  };
}

export function consumePendingAndroidSharedText(): string[] {
  if (typeof window === "undefined") return [];
  const pending = window.__codeforgePendingAndroidSharedText ?? [];
  window.__codeforgePendingAndroidSharedText = [];
  return pending;
}

export function onAndroidSharedText(listener: (text: string) => void): () => void {
  if (typeof window === "undefined") return () => undefined;

  const handler = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const text = normalizeSharedText(event.detail);
    if (text) listener(text);
  };

  window.addEventListener(ANDROID_SHARE_EVENT, handler);
  return () => window.removeEventListener(ANDROID_SHARE_EVENT, handler);
}

export function notifyAndroid(
  kind: AndroidNotificationKind,
  title: string,
  body: string,
): void {
  if (!isAndroidApp()) return;
  try {
    window.CodeForgeAndroid?.notify?.(kind, title, body);
  } catch {
    // The Android bridge is an optional enhancement. Never let a native bridge
    // failure interrupt the coding-agent UI.
  }
}
