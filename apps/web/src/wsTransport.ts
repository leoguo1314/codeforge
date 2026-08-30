import {
  type WsPush,
  type WsPushChannel,
  type WsPushMessage,
  WebSocketResponse,
  type WsResponse as WsResponseMessage,
  WsResponse as WsResponseSchema,
} from "@codeforge/contracts";
import { decodeUnknownJsonResult, formatSchemaError } from "@codeforge/shared/schemaJson";
import { Result, Schema } from "effect";

type PushListener<C extends WsPushChannel> = (message: WsPushMessage<C>) => void;
type StateListener = (state: TransportState) => void;

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout> | null;
}

interface SubscribeOptions {
  readonly replayLatest?: boolean;
}

interface RequestOptions {
  readonly timeoutMs?: number | null;
}

export type TransportState =
  | "connecting"
  | "open"
  | "reconnecting"
  | "offline"
  | "closed"
  | "disposed";

const REQUEST_TIMEOUT_MS = 60_000;
const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000];
const decodeWsResponse = decodeUnknownJsonResult(WsResponseSchema);
const isWebSocketResponseEnvelope = Schema.is(WebSocketResponse);

const isWsPushMessage = (value: WsResponseMessage): value is WsPush =>
  "type" in value && value.type === "push";

interface WsRequestEnvelope {
  id: string;
  body: {
    _tag: string;
    [key: string]: unknown;
  };
}

export interface BrowserWsLocation {
  readonly protocol?: string;
  readonly host?: string;
  readonly hostname: string;
  readonly port: string;
  readonly search?: string;
}

/**
 * Resolve the WebSocket endpoint for browser/mobile clients served by the
 * CodeForge server itself. The server authenticates WebSocket upgrades via a
 * `token` query parameter, so preserve that token when the page was opened as
 * `https://host/?token=...` (the Android client uses this path).
 */
export function resolveBrowserWsUrl(location: BrowserWsLocation): string {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const host =
    location.host && location.host.length > 0
      ? location.host
      : location.port.length > 0
        ? `${location.hostname}:${location.port}`
        : location.hostname;
  const baseUrl = `${protocol}://${host}`;
  const token = new URLSearchParams(location.search ?? "").get("token");
  return token && token.length > 0 ? `${baseUrl}?token=${encodeURIComponent(token)}` : baseUrl;
}

function asError(value: unknown, fallback: string): Error {
  if (value instanceof Error) {
    return value;
  }
  return new Error(fallback);
}

function browserIsOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export class WsTransport {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly listeners = new Map<string, Set<(message: WsPush) => void>>();
  private readonly latestPushByChannel = new Map<string, WsPush>();
  private readonly stateListeners = new Set<StateListener>();
  private readonly outboundQueue: string[] = [];
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private state: TransportState = "connecting";
  private readonly url: string;
  private readonly handleBrowserOnline = () => {
    if (this.disposed) return;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.setState("open");
      return;
    }
    this.retryNow();
  };
  private readonly handleBrowserOffline = () => {
    if (this.disposed) return;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.setState("offline");
  };

  constructor(url?: string) {
    const bridgeUrl = window.desktopBridge?.getWsUrl();
    const envUrl = import.meta.env.VITE_WS_URL as string | undefined;
    this.url =
      url ??
      (bridgeUrl && bridgeUrl.length > 0
        ? bridgeUrl
        : envUrl && envUrl.length > 0
          ? envUrl
          : resolveBrowserWsUrl(window.location));

    if (typeof window.addEventListener === "function") {
      window.addEventListener("online", this.handleBrowserOnline);
      window.addEventListener("offline", this.handleBrowserOffline);
    }
    this.connect();
  }

  async request<T = unknown>(
    method: string,
    params?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    if (typeof method !== "string" || method.length === 0) {
      throw new Error("Request method is required");
    }

    const id = String(this.nextId++);
    const body = params != null ? { ...params, _tag: method } : { _tag: method };
    const message: WsRequestEnvelope = { id, body };
    const encoded = JSON.stringify(message);

    return new Promise<T>((resolve, reject) => {
      const timeoutMs = options?.timeoutMs === undefined ? REQUEST_TIMEOUT_MS : options.timeoutMs;
      const timeout =
        timeoutMs === null
          ? null
          : setTimeout(() => {
              this.pending.delete(id);
              reject(new Error(`Request timed out: ${method}`));
            }, timeoutMs);

      this.pending.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timeout,
      });

      this.send(encoded);
    });
  }

  subscribe<C extends WsPushChannel>(
    channel: C,
    listener: PushListener<C>,
    options?: SubscribeOptions,
  ): () => void {
    let channelListeners = this.listeners.get(channel);
    if (!channelListeners) {
      channelListeners = new Set<(message: WsPush) => void>();
      this.listeners.set(channel, channelListeners);
    }

    const wrappedListener = (message: WsPush) => {
      listener(message as WsPushMessage<C>);
    };
    channelListeners.add(wrappedListener);

    if (options?.replayLatest) {
      const latest = this.latestPushByChannel.get(channel);
      if (latest) {
        wrappedListener(latest);
      }
    }

    return () => {
      channelListeners?.delete(wrappedListener);
      if (channelListeners?.size === 0) {
        this.listeners.delete(channel);
      }
    };
  }

  subscribeState(listener: StateListener, options?: SubscribeOptions): () => void {
    this.stateListeners.add(listener);
    if (options?.replayLatest !== false) {
      try {
        listener(this.state);
      } catch {
        // State observers are optional UI integrations; never break transport.
      }
    }
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  getLatestPush<C extends WsPushChannel>(channel: C): WsPushMessage<C> | null {
    const latest = this.latestPushByChannel.get(channel);
    return latest ? (latest as WsPushMessage<C>) : null;
  }

  getState(): TransportState {
    return this.state;
  }

  retryNow(): void {
    if (this.disposed || this.state === "open" || this.state === "connecting") {
      return;
    }
    if (browserIsOffline()) {
      this.setState("offline");
      return;
    }
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempt = Math.max(1, this.reconnectAttempt);
    this.connect();
  }

  dispose() {
    this.disposed = true;
    if (typeof window.removeEventListener === "function") {
      window.removeEventListener("online", this.handleBrowserOnline);
      window.removeEventListener("offline", this.handleBrowserOffline);
    }
    this.setState("disposed");
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const pending of this.pending.values()) {
      if (pending.timeout !== null) {
        clearTimeout(pending.timeout);
      }
      pending.reject(new Error("Transport disposed"));
    }
    this.pending.clear();
    this.outboundQueue.length = 0;
    this.ws?.close();
    this.ws = null;
    this.stateListeners.clear();
  }

  private setState(nextState: TransportState): void {
    if (this.state === nextState) return;
    this.state = nextState;
    for (const listener of this.stateListeners) {
      try {
        listener(nextState);
      } catch {
        // Swallow observer errors; transport state must remain authoritative.
      }
    }
  }

  private connect() {
    if (this.disposed) {
      return;
    }
    if (browserIsOffline()) {
      this.setState("offline");
      return;
    }

    this.setState(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");
    const ws = new WebSocket(this.url);

    ws.addEventListener("open", () => {
      this.ws = ws;
      this.setState("open");
      this.reconnectAttempt = 0;
      this.flushQueue();
    });

    ws.addEventListener("message", (event) => {
      this.handleMessage(event.data);
    });

    ws.addEventListener("close", () => {
      if (this.ws === ws) {
        this.ws = null;
        this.outboundQueue.length = 0;
        for (const [id, pending] of this.pending.entries()) {
          if (pending.timeout !== null) {
            clearTimeout(pending.timeout);
          }
          this.pending.delete(id);
          pending.reject(new Error("WebSocket connection closed."));
        }
      }
      if (this.disposed) {
        this.setState("disposed");
        return;
      }
      if (browserIsOffline()) {
        this.setState("offline");
        return;
      }
      this.setState("closed");
      this.scheduleReconnect();
    });

    ws.addEventListener("error", (event) => {
      // Log WebSocket errors for debugging (close event will follow)
      console.warn("WebSocket connection error", { type: event.type, url: this.url });
    });
  }

  private handleMessage(raw: unknown) {
    const result = decodeWsResponse(raw);
    if (Result.isFailure(result)) {
      console.warn("Dropped inbound WebSocket envelope", formatSchemaError(result.failure));
      return;
    }

    const message = result.success;
    if (isWsPushMessage(message)) {
      this.latestPushByChannel.set(message.channel, message);
      const channelListeners = this.listeners.get(message.channel);
      if (channelListeners) {
        for (const listener of channelListeners) {
          try {
            listener(message);
          } catch {
            // Swallow listener errors
          }
        }
      }
      return;
    }

    if (!isWebSocketResponseEnvelope(message)) {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    if (pending.timeout !== null) {
      clearTimeout(pending.timeout);
    }
    this.pending.delete(message.id);

    if (message.error) {
      pending.reject(new Error(message.error.message));
      return;
    }

    pending.resolve(message.result);
  }

  private send(encodedMessage: string) {
    if (this.disposed) {
      return;
    }

    this.outboundQueue.push(encodedMessage);
    try {
      this.flushQueue();
    } catch {
      // Swallow: flushQueue has queued the message for retry on reconnect
    }
  }

  private flushQueue() {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return;
    }

    while (this.outboundQueue.length > 0) {
      const message = this.outboundQueue.shift();
      if (!message) {
        continue;
      }
      try {
        this.ws.send(message);
      } catch (error) {
        this.outboundQueue.unshift(message);
        throw asError(error, "Failed to send WebSocket request.");
      }
    }
  }

  private scheduleReconnect() {
    if (this.disposed || this.reconnectTimer !== null) {
      return;
    }
    if (browserIsOffline()) {
      this.setState("offline");
      return;
    }

    this.setState("reconnecting");
    const delay =
      RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)] ??
      RECONNECT_DELAYS_MS[0]!;

    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
