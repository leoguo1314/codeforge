import type {
  MobileListPushOutboxInput,
  MobileListPushOutboxResult,
  MobilePairingCreateResult,
  MobilePurgePushOutboxInput,
  MobilePurgePushOutboxResult,
  MobileReplayDeadPushInput,
  MobileReplayDeadPushResult,
} from "@codeforge/contracts";

const resolveServerBase = (): URL => {
  if (window.location.protocol === "http:" || window.location.protocol === "https:") {
    return new URL(window.location.origin);
  }

  const wsUrl = window.desktopBridge?.getWsUrl?.();
  if (wsUrl) {
    const parsed = new URL(wsUrl);
    parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
    parsed.pathname = "/";
    parsed.search = "";
    parsed.hash = "";
    return parsed;
  }

  throw new Error("Unable to resolve the CodeForge server address.");
};

const resolveAdminToken = (): string | null => {
  const pageToken = new URLSearchParams(window.location.search).get("token")?.trim();
  if (pageToken) return pageToken;

  const wsUrl = window.desktopBridge?.getWsUrl?.();
  if (!wsUrl) return null;
  try {
    return new URL(wsUrl).searchParams.get("token")?.trim() || null;
  } catch {
    return null;
  }
};

const request = async <T>(path: string, body: unknown): Promise<T> => {
  const endpoint = new URL(path.replace(/^\//, ""), resolveServerBase());
  const token = resolveAdminToken();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };
  if (token) headers.authorization = `Bearer ${token}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    cache: "no-store",
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: unknown } & T;
  if (!response.ok) {
    const message = typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
};

export const createMobilePairingCode = () =>
  request<MobilePairingCreateResult>("/api/mobile/pair/create", {});

export const listMobilePushOutbox = (input: MobileListPushOutboxInput) =>
  request<MobileListPushOutboxResult>("/api/mobile/push/outbox", input);

export const replayMobileDeadPush = (input: MobileReplayDeadPushInput) =>
  request<MobileReplayDeadPushResult>("/api/mobile/push/outbox/replay", input);

export const purgeMobilePushOutbox = (input: MobilePurgePushOutboxInput) =>
  request<MobilePurgePushOutboxResult>("/api/mobile/push/outbox/purge", input);
