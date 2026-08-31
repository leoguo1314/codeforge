import type http from "node:http";
import type { Duplex } from "node:stream";

import {
  MobileListPushOutboxInput,
  MobilePairingRedeemInput,
  MobilePurgePushOutboxInput,
  MobileReplayDeadPushInput,
} from "@codeforge/contracts";
import { Effect, Layer, Schema } from "effect";

import { ServerConfig } from "./config.ts";
import { MobilePairing } from "./mobile/Services/MobilePairing.ts";
import { PushOutbox } from "./mobile/Services/PushOutbox.ts";
import {
  createServer as createCoreServer,
  Server,
  type ServerShape,
} from "./wsServerCore.ts";

export { Server, ServerLifecycleError } from "./wsServerCore.ts";
export type {
  ServerShape,
  ServerCoreRuntimeServices,
  ServerRuntimeServices,
} from "./wsServerCore.ts";

const MOBILE_ROUTE_PREFIX = "/api/mobile/";
const MAX_JSON_BYTES = 16 * 1024;

const sendJson = (
  response: http.ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) => {
  const encoded = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": String(Buffer.byteLength(encoded)),
    ...headers,
  });
  response.end(encoded);
};

const readJsonBody = async (request: http.IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const raw of request) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    total += chunk.byteLength;
    if (total > MAX_JSON_BYTES) throw new Error("request body too large");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(text || "{}");
};

const providedAdminToken = (request: http.IncomingMessage, url: URL): string | null => {
  const authorization = request.headers.authorization?.trim() ?? "";
  if (authorization.toLowerCase().startsWith("bearer ")) {
    const bearer = authorization.slice(7).trim();
    if (bearer) return bearer;
  }
  return url.searchParams.get("token");
};

const invokeListeners = (
  server: http.Server,
  listeners: ReadonlyArray<Function>,
  args: ReadonlyArray<unknown>,
) => {
  for (const listener of listeners) listener.apply(server, args);
};

export const createServer = Effect.fn(function* () {
  const config = yield* ServerConfig;
  const pairing = yield* MobilePairing;
  const outbox = yield* PushOutbox;
  const server = yield* createCoreServer();

  const originalRequestListeners = server.listeners("request");
  server.removeAllListeners("request");
  server.on("request", (request, response) => {
    const url = new URL(request.url ?? "/", `http://localhost:${config.port}`);
    if (!url.pathname.startsWith(MOBILE_ROUTE_PREFIX)) {
      invokeListeners(server, originalRequestListeners, [request, response]);
      return;
    }

    const run = async () => {
      if (url.pathname === "/api/mobile/pair/redeem") {
        if (request.method !== "POST") {
          sendJson(response, 405, { error: "Method not allowed" }, { allow: "POST" });
          return;
        }
        try {
          const raw = await readJsonBody(request);
          const input = await Effect.runPromise(
            Schema.decodeUnknownEffect(MobilePairingRedeemInput)(raw),
          );
          const result = await Effect.runPromise(pairing.redeemCode(input));
          sendJson(response, 200, result);
        } catch {
          sendJson(response, 400, { error: "Pairing code is invalid, expired, or already used." });
        }
        return;
      }

      if (config.authToken) {
        const supplied = providedAdminToken(request, url);
        if (supplied !== config.authToken) {
          sendJson(response, 401, { error: "Administrator authentication required." });
          return;
        }
      }

      try {
        if (url.pathname === "/api/mobile/pair/create") {
          if (request.method !== "POST") {
            sendJson(response, 405, { error: "Method not allowed" }, { allow: "POST" });
            return;
          }
          sendJson(response, 200, await Effect.runPromise(pairing.createCode()));
          return;
        }

        if (url.pathname === "/api/mobile/push/outbox") {
          if (request.method !== "POST") {
            sendJson(response, 405, { error: "Method not allowed" }, { allow: "POST" });
            return;
          }
          const raw = await readJsonBody(request);
          const input = await Effect.runPromise(
            Schema.decodeUnknownEffect(MobileListPushOutboxInput)(raw),
          );
          const entries = await Effect.runPromise(outbox.list(input.status, input.limit));
          sendJson(response, 200, { entries });
          return;
        }

        if (url.pathname === "/api/mobile/push/outbox/replay") {
          if (request.method !== "POST") {
            sendJson(response, 405, { error: "Method not allowed" }, { allow: "POST" });
            return;
          }
          const raw = await readJsonBody(request);
          const input = await Effect.runPromise(
            Schema.decodeUnknownEffect(MobileReplayDeadPushInput)(raw),
          );
          const replayed = await Effect.runPromise(outbox.replayDead(input.deliveryId));
          sendJson(response, 200, { deliveryId: input.deliveryId, replayed });
          return;
        }

        if (url.pathname === "/api/mobile/push/outbox/purge") {
          if (request.method !== "POST") {
            sendJson(response, 405, { error: "Method not allowed" }, { allow: "POST" });
            return;
          }
          const raw = await readJsonBody(request);
          const input = await Effect.runPromise(
            Schema.decodeUnknownEffect(MobilePurgePushOutboxInput)(raw),
          );
          const deleted = await Effect.runPromise(outbox.purge(input));
          sendJson(response, 200, { deleted });
          return;
        }

        sendJson(response, 404, { error: "Not found" });
      } catch (cause) {
        sendJson(response, 500, {
          error: cause instanceof Error ? cause.message : "Mobile administration request failed.",
        });
      }
    };

    void run();
  });

  // The core server still owns WebSocket upgrade mechanics. For a valid mobile
  // session we rewrite only the internal request token to the administrator
  // token before delegating, so no core routing/connection behavior is forked.
  const originalUpgradeListeners = server.listeners("upgrade");
  server.removeAllListeners("upgrade");
  server.on("upgrade", (request, socket: Duplex, head) => {
    if (!config.authToken) {
      invokeListeners(server, originalUpgradeListeners, [request, socket, head]);
      return;
    }

    let supplied: string | null = null;
    let parsed: URL | null = null;
    try {
      parsed = new URL(request.url ?? "/", `http://localhost:${config.port}`);
      supplied = parsed.searchParams.get("token");
    } catch {
      invokeListeners(server, originalUpgradeListeners, [request, socket, head]);
      return;
    }

    if (!supplied || supplied === config.authToken) {
      invokeListeners(server, originalUpgradeListeners, [request, socket, head]);
      return;
    }

    void Effect.runPromise(
      pairing
        .validateSessionToken(supplied)
        .pipe(Effect.catch(() => Effect.succeed(false))),
    ).then((valid) => {
      if (socket.destroyed) return;
      if (valid && parsed) {
        parsed.searchParams.set("token", config.authToken!);
        request.url = `${parsed.pathname}${parsed.search}`;
      }
      invokeListeners(server, originalUpgradeListeners, [request, socket, head]);
    });
  });

  return server;
});

export const ServerLive = Layer.succeed(Server, {
  start: createServer() as ServerShape["start"],
  stopSignal: Effect.never,
} satisfies ServerShape);
