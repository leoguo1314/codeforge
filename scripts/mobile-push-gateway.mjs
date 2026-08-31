#!/usr/bin/env node

import { createServer } from "node:http";
import { createSign } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_PORT = 8787;
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const FCM_TOKEN_URI = "https://oauth2.googleapis.com/token";
const HUAWEI_TOKEN_URI = "https://oauth-login.cloud.huawei.com/oauth2/v3/token";

const tokenCache = new Map();
const inFlight = new Map();

const asString = (value) => (typeof value === "string" ? value.trim() : "");
const json = (response, status, body) => {
  const encoded = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(encoded),
  });
  response.end(encoded);
};

const readJsonBody = async (request, maxBytes = 64 * 1024) => {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) throw new Error("request body too large");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(text || "{}");
};

export const normalizeGatewayEnvelope = (raw) => {
  if (!raw || typeof raw !== "object" || raw.version !== 2) {
    throw new Error("unsupported gateway payload version");
  }
  const deliveryId = asString(raw.deliveryId);
  const device = raw.device;
  const notification = raw.notification;
  if (!deliveryId || !device || typeof device !== "object") {
    throw new Error("missing delivery or device");
  }
  const provider = asString(device.pushProvider);
  const pushToken = asString(device.pushToken);
  if (!pushToken || (provider !== "fcm" && provider !== "huawei")) {
    throw new Error("unsupported or missing push provider token");
  }
  if (!notification || typeof notification !== "object") {
    throw new Error("missing notification");
  }
  const kind = asString(notification.kind);
  const title = asString(notification.title);
  const body = asString(notification.body);
  const createdAt = asString(notification.createdAt);
  if (!title || !body || !createdAt) throw new Error("invalid notification");

  return {
    deliveryId,
    attempt: Number.isFinite(raw.attempt) ? raw.attempt : 1,
    device: {
      deviceId: asString(device.deviceId),
      provider,
      pushToken,
    },
    notification: {
      kind: ["approval", "input", "complete", "info"].includes(kind) ? kind : "info",
      threadId: typeof notification.threadId === "string" ? notification.threadId : null,
      title,
      body,
      createdAt,
    },
  };
};

export const makeFcmMessageBody = (envelope) => ({
  message: {
    token: envelope.device.pushToken,
    data: {
      deliveryId: envelope.deliveryId,
      kind: envelope.notification.kind,
      threadId: envelope.notification.threadId ?? "",
      title: envelope.notification.title,
      body: envelope.notification.body,
      createdAt: envelope.notification.createdAt,
    },
    android: { priority: "high" },
  },
});

export const makeHuaweiMessageBody = (envelope) => ({
  validate_only: false,
  message: {
    data: JSON.stringify({
      deliveryId: envelope.deliveryId,
      kind: envelope.notification.kind,
      threadId: envelope.notification.threadId,
      title: envelope.notification.title,
      body: envelope.notification.body,
      createdAt: envelope.notification.createdAt,
    }),
    android: {
      urgency: "HIGH",
    },
    token: [envelope.device.pushToken],
  },
});

const base64Url = (value) => Buffer.from(value).toString("base64url");

const loadFcmServiceAccount = async () => {
  const file = asString(process.env.CODEFORGE_FCM_SERVICE_ACCOUNT_FILE);
  if (!file) throw new Error("CODEFORGE_FCM_SERVICE_ACCOUNT_FILE is not configured");
  const parsed = JSON.parse(await readFile(file, "utf8"));
  const projectId = asString(parsed.project_id);
  const clientEmail = asString(parsed.client_email);
  const privateKey = asString(parsed.private_key);
  const tokenUri = asString(parsed.token_uri) || FCM_TOKEN_URI;
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("invalid FCM service account file");
  }
  return { projectId, clientEmail, privateKey, tokenUri };
};

const fetchFcmAccessToken = async () => {
  const account = await loadFcmServiceAccount();
  const cacheKey = `fcm:${account.clientEmail}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 300_000) return { ...account, accessToken: cached.token };

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: account.clientEmail,
    scope: FCM_SCOPE,
    aud: account.tokenUri,
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const assertion = `${signingInput}.${signer.sign(account.privateKey).toString("base64url")}`;

  const response = await fetch(account.tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) throw new Error(`FCM OAuth returned HTTP ${response.status}`);
  const body = await response.json();
  const token = asString(body.access_token);
  const expiresIn = Number(body.expires_in ?? 3600);
  if (!token) throw new Error("FCM OAuth response did not include access_token");
  tokenCache.set(cacheKey, { token, expiresAt: Date.now() + Math.max(expiresIn, 60) * 1000 });
  return { ...account, accessToken: token };
};

const sendFcm = async (envelope) => {
  const auth = await fetchFcmAccessToken();
  const endpoint = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(auth.projectId)}/messages:send`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${auth.accessToken}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(makeFcmMessageBody(envelope)),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`FCM send returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
};

const fetchHuaweiAccessToken = async () => {
  const clientId = asString(process.env.CODEFORGE_HUAWEI_CLIENT_ID);
  const clientSecret = asString(process.env.CODEFORGE_HUAWEI_CLIENT_SECRET);
  if (!clientId || !clientSecret) throw new Error("Huawei client credentials are not configured");
  const cacheKey = `huawei:${clientId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 300_000) return { clientId, accessToken: cached.token };

  const response = await fetch(HUAWEI_TOKEN_URI, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
  });
  if (!response.ok) throw new Error(`Huawei OAuth returned HTTP ${response.status}`);
  const body = await response.json();
  const token = asString(body.access_token);
  const expiresIn = Number(body.expires_in ?? 3600);
  if (!token) throw new Error("Huawei OAuth response did not include access_token");
  tokenCache.set(cacheKey, { token, expiresAt: Date.now() + Math.max(expiresIn, 60) * 1000 });
  return { clientId, accessToken: token };
};

const sendHuawei = async (envelope) => {
  const auth = await fetchHuaweiAccessToken();
  const endpoint = `https://push-api.cloud.huawei.com/v1/${encodeURIComponent(auth.clientId)}/messages:send`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${auth.accessToken}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(makeHuaweiMessageBody(envelope)),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Huawei Push returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  const body = await response.json().catch(() => ({}));
  if (body && typeof body === "object" && typeof body.code === "string" && body.code !== "80000000") {
    throw new Error(`Huawei Push returned code ${body.code}`);
  }
};

const stateDir = () => asString(process.env.CODEFORGE_PUSH_GATEWAY_STATE_DIR) || ".codeforge-push-gateway";
const markerPath = (deliveryId) => join(stateDir(), "delivered", deliveryId);

const alreadyDelivered = async (deliveryId) => {
  try {
    await stat(markerPath(deliveryId));
    return true;
  } catch {
    return false;
  }
};

const markDelivered = async (deliveryId) => {
  const directory = join(stateDir(), "delivered");
  await mkdir(directory, { recursive: true });
  await writeFile(markerPath(deliveryId), new Date().toISOString(), { flag: "wx" }).catch((error) => {
    if (error?.code !== "EEXIST") throw error;
  });
};

export const deliverEnvelope = async (envelope) => {
  if (await alreadyDelivered(envelope.deliveryId)) return { duplicate: true };
  const existing = inFlight.get(envelope.deliveryId);
  if (existing) return existing;

  const promise = (async () => {
    if (envelope.device.provider === "fcm") await sendFcm(envelope);
    else if (envelope.device.provider === "huawei") await sendHuawei(envelope);
    else throw new Error(`unsupported provider ${envelope.device.provider}`);
    await markDelivered(envelope.deliveryId);
    return { duplicate: false };
  })();
  inFlight.set(envelope.deliveryId, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(envelope.deliveryId);
  }
};

export const createGatewayServer = () =>
  createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/healthz") {
        return json(response, 200, { ok: true });
      }
      if (request.method !== "POST" || request.url !== "/codeforge") {
        return json(response, 404, { error: "not found" });
      }

      const expectedToken = asString(process.env.CODEFORGE_PUSH_GATEWAY_TOKEN);
      if (expectedToken) {
        const authorization = asString(request.headers.authorization);
        if (authorization !== `Bearer ${expectedToken}`) return json(response, 401, { error: "unauthorized" });
      }

      const envelope = normalizeGatewayEnvelope(await readJsonBody(request));
      const result = await deliverEnvelope(envelope);
      return json(response, 200, { ok: true, duplicate: result.duplicate, deliveryId: envelope.deliveryId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("CodeForge push gateway delivery failed:", message);
      return json(response, 502, { error: message.slice(0, 500) });
    }
  });

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number.parseInt(process.env.CODEFORGE_PUSH_GATEWAY_PORT ?? "", 10) || DEFAULT_PORT;
  const host = asString(process.env.CODEFORGE_PUSH_GATEWAY_HOST) || "127.0.0.1";
  const server = createGatewayServer();
  server.listen(port, host, () => {
    console.log(`CodeForge mobile push gateway listening on http://${host}:${port}/codeforge`);
  });
}
