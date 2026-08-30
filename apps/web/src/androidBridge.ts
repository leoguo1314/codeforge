import type { MobileDeviceRegistrationInput, MobilePushProvider } from "@codeforge/contracts";

import { WS_TRANSPORT_STATE_EVENT, type TransportState } from "./wsTransport";

const ANDROID_SHARE_EVENT = "codeforge:android-share";
const ANDROID_DEVICE_ID_STORAGE_KEY = "codeforge.android.deviceId";

export const ANDROID_SHARE_PREFIX = "__CODEFORGE_ANDROID_SHARE_V1__";
export const ANDROID_CLIENT_VERSION = "0.6.0";

export type AndroidNotificationKind = "approval" | "complete" | "input" | "info";

export type AndroidSharedImage = {
  name: string;
  mimeType: string;
  dataUrl: string;
};

export type AndroidSharedPayload =
  | {
      kind: "text";
      text: string;
    }
  | ({ kind: "image"; text?: string } & AndroidSharedImage)
  | {
      kind: "images";
      images: AndroidSharedImage[];
      text?: string;
    };

type NativePushRegistration = {
  deviceId?: string;
  pushProvider?: MobilePushProvider;
  pushToken?: string | null;
  appVersion?: string;
  deviceLabel?: string | null;
};

type AndroidJavascriptBridge = {
  notify?: (kind: AndroidNotificationKind, title: string, body: string) => void;
  connectionState?: (state: TransportState) => void;
  /** Optional v0.6+ native provider descriptor. JSON keeps the JS bridge narrow. */
  pushRegistration?: () => string;
};

declare global {
  interface Window {
    CodeForgeAndroid?: AndroidJavascriptBridge;
    __codeforgePendingAndroidShares?: AndroidSharedPayload[];
    __codeforgeReceiveSharedText?: (text: string) => void;
  }
}

function normalizeSharedText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

function parseSharedImage(value: unknown): AndroidSharedImage | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const name = normalizeSharedText(record.name);
  const mimeType = normalizeSharedText(record.mimeType);
  const dataUrl = normalizeSharedText(record.dataUrl);
  if (!name || !mimeType?.startsWith("image/") || !dataUrl?.startsWith("data:image/")) {
    return null;
  }
  return { name, mimeType, dataUrl };
}

export function parseAndroidSharedPayload(rawValue: unknown): AndroidSharedPayload | null {
  const rawText = normalizeSharedText(rawValue);
  if (!rawText) return null;

  if (!rawText.startsWith(ANDROID_SHARE_PREFIX)) {
    return { kind: "text", text: rawText };
  }

  try {
    const parsed = JSON.parse(rawText.slice(ANDROID_SHARE_PREFIX.length)) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    const text = normalizeSharedText(record.text);

    if (record.kind === "image") {
      const image = parseSharedImage(record);
      if (!image) return null;
      return {
        kind: "image",
        ...image,
        ...(text ? { text } : {}),
      };
    }

    if (record.kind === "images") {
      if (!Array.isArray(record.images) || record.images.length === 0) return null;
      const images = record.images.map(parseSharedImage);
      if (images.some((image) => image === null)) return null;
      return {
        kind: "images",
        images: images as AndroidSharedImage[],
        ...(text ? { text } : {}),
      };
    }

    return null;
  } catch {
    return null;
  }
}

export function isAndroidApp(): boolean {
  return typeof window !== "undefined" && typeof window.CodeForgeAndroid === "object";
}

function parseNativePushRegistration(rawValue: unknown): NativePushRegistration | null {
  const raw = normalizeSharedText(rawValue);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    const provider = record.pushProvider;
    const pushProvider: MobilePushProvider =
      provider === "fcm" || provider === "huawei" || provider === "gateway" ? provider : "none";
    const pushToken = normalizeSharedText(record.pushToken);
    const deviceId = normalizeSharedText(record.deviceId);
    const appVersion = normalizeSharedText(record.appVersion);
    return {
      pushProvider,
      pushToken: pushProvider === "none" ? null : pushToken,
      deviceLabel: normalizeSharedText(record.deviceLabel),
      ...(deviceId ? { deviceId } : {}),
      ...(appVersion ? { appVersion } : {}),
    };
  } catch {
    return null;
  }
}

export function getOrCreateAndroidDeviceId(storage: Pick<Storage, "getItem" | "setItem">): string {
  const existing = normalizeSharedText(storage.getItem(ANDROID_DEVICE_ID_STORAGE_KEY));
  if (existing) return existing;
  const generated = crypto.randomUUID();
  storage.setItem(ANDROID_DEVICE_ID_STORAGE_KEY, generated);
  return generated;
}

export function readAndroidDeviceRegistration(): MobileDeviceRegistrationInput | null {
  if (!isAndroidApp()) return null;

  let native: NativePushRegistration | null = null;
  try {
    native = parseNativePushRegistration(window.CodeForgeAndroid?.pushRegistration?.());
  } catch {
    native = null;
  }

  const deviceId = native?.deviceId ?? getOrCreateAndroidDeviceId(window.localStorage);
  return {
    deviceId,
    platform: "android",
    pushProvider: native?.pushProvider ?? "none",
    pushToken: native?.pushToken ?? null,
    // Until a native provider bridge reports BuildConfig.VERSION_NAME, use the
    // v0.6 mobile contract version rather than the legacy v0.5 User-Agent tag.
    appVersion: native?.appVersion ?? ANDROID_CLIENT_VERSION,
    deviceLabel: native?.deviceLabel ?? "Android device",
  };
}

export function installAndroidBridge(): void {
  if (typeof window === "undefined") return;

  if (isAndroidApp()) {
    document.documentElement.classList.add("codeforge-android");
  }

  window.__codeforgePendingAndroidShares ??= [];
  window.__codeforgeReceiveSharedText = (rawText: string) => {
    const payload = parseAndroidSharedPayload(rawText);
    if (!payload) return;

    window.__codeforgePendingAndroidShares?.push(payload);
    window.dispatchEvent(new CustomEvent<AndroidSharedPayload>(ANDROID_SHARE_EVENT, { detail: payload }));
  };

  window.addEventListener(WS_TRANSPORT_STATE_EVENT, (event) => {
    if (!(event instanceof CustomEvent)) return;
    const state = event.detail as TransportState | undefined;
    if (!state || !isAndroidApp()) return;
    try {
      window.CodeForgeAndroid?.connectionState?.(state);
    } catch {
      // Native shell status is best-effort and must never affect transport.
    }
  });
}

export function consumePendingAndroidShares(): AndroidSharedPayload[] {
  if (typeof window === "undefined") return [];
  const pending = window.__codeforgePendingAndroidShares ?? [];
  window.__codeforgePendingAndroidShares = [];
  return pending;
}

export function onAndroidShare(listener: (payload: AndroidSharedPayload) => void): () => void {
  if (typeof window === "undefined") return () => undefined;

  const handler = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const payload = event.detail as AndroidSharedPayload | undefined;
    if (!payload || !["text", "image", "images"].includes(payload.kind)) return;
    listener(payload);
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
