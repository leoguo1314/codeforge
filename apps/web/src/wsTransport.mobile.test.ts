import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WsTransport, type TransportState } from "./wsTransport";

type WsEventType = "open" | "message" | "close" | "error";
type WsListener = (event?: { data?: unknown }) => void;

const sockets: MockWebSocket[] = [];
const windowListeners = new Map<string, Set<() => void>>();

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  private readonly listeners = new Map<WsEventType, Set<WsListener>>();

  constructor(readonly url: string) {
    sockets.push(this);
  }

  addEventListener(type: WsEventType, listener: WsListener) {
    const listeners = this.listeners.get(type) ?? new Set<WsListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  send() {}

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close");
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.emit("open");
  }

  private emit(type: WsEventType, event?: { data?: unknown }) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const originalWebSocket = globalThis.WebSocket;
const originalWindow = globalThis.window;
const originalNavigator = globalThis.navigator;

function emitWindow(type: string) {
  for (const listener of windowListeners.get(type) ?? []) listener();
}

function setOnline(online: boolean) {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: online },
  });
}

beforeEach(() => {
  sockets.length = 0;
  windowListeners.clear();
  setOnline(true);

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        protocol: "http:",
        host: "localhost:3020",
        hostname: "localhost",
        port: "3020",
        search: "",
      },
      desktopBridge: undefined,
      addEventListener(type: string, listener: () => void) {
        const listeners = windowListeners.get(type) ?? new Set<() => void>();
        listeners.add(listener);
        windowListeners.set(type, listeners);
      },
      removeEventListener(type: string, listener: () => void) {
        windowListeners.get(type)?.delete(listener);
      },
      dispatchEvent() {
        return true;
      },
    },
  });
  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
});

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
});

describe("WsTransport mobile connection lifecycle", () => {
  it("publishes connection states and reconnects immediately when the browser comes online", () => {
    const transport = new WsTransport("ws://localhost:3020");
    const states: TransportState[] = [];
    transport.subscribeState((state) => states.push(state));

    expect(states).toEqual(["connecting"]);
    expect(sockets).toHaveLength(1);

    sockets[0]?.open();
    expect(states.at(-1)).toBe("open");

    setOnline(false);
    emitWindow("offline");
    expect(states.at(-1)).toBe("offline");

    setOnline(true);
    emitWindow("online");
    expect(states.at(-1)).toBe("reconnecting");
    expect(sockets).toHaveLength(2);

    sockets[1]?.open();
    expect(states.at(-1)).toBe("open");

    transport.dispose();
    expect(states.at(-1)).toBe("disposed");
  });

  it("does not create a socket while the browser reports offline", () => {
    setOnline(false);
    const transport = new WsTransport("ws://localhost:3020");

    expect(transport.getState()).toBe("offline");
    expect(sockets).toHaveLength(0);

    setOnline(true);
    emitWindow("online");
    expect(sockets).toHaveLength(1);
    expect(transport.getState()).toBe("reconnecting");

    transport.dispose();
  });
});
