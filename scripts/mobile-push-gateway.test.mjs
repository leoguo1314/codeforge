import assert from "node:assert/strict";
import test from "node:test";

import {
  makeFcmMessageBody,
  makeHuaweiMessageBody,
  normalizeGatewayEnvelope,
} from "./mobile-push-gateway.mjs";

const rawEnvelope = {
  version: 2,
  deliveryId: "delivery-123",
  attempt: 2,
  device: {
    deviceId: "device-1",
    platform: "android",
    pushProvider: "fcm",
    pushToken: "opaque-token",
    appVersion: "0.8.0",
    deviceLabel: "Android device",
  },
  notification: {
    kind: "approval",
    threadId: "thread-1",
    title: "Approval required",
    body: "CodeForge needs approval.",
    createdAt: "2026-08-31T01:00:00.000Z",
  },
};

test("normalizes the CodeForge gateway v2 envelope", () => {
  const envelope = normalizeGatewayEnvelope(rawEnvelope);
  assert.equal(envelope.deliveryId, "delivery-123");
  assert.equal(envelope.attempt, 2);
  assert.equal(envelope.device.provider, "fcm");
  assert.equal(envelope.notification.kind, "approval");
});

test("FCM payload preserves canonical notification fields as data", () => {
  const envelope = normalizeGatewayEnvelope(rawEnvelope);
  assert.deepEqual(makeFcmMessageBody(envelope), {
    message: {
      token: "opaque-token",
      data: {
        deliveryId: "delivery-123",
        kind: "approval",
        threadId: "thread-1",
        title: "Approval required",
        body: "CodeForge needs approval.",
        createdAt: "2026-08-31T01:00:00.000Z",
      },
      android: { priority: "high" },
    },
  });
});

test("Huawei payload uses one data message token target", () => {
  const envelope = normalizeGatewayEnvelope({
    ...rawEnvelope,
    device: { ...rawEnvelope.device, pushProvider: "huawei" },
  });
  const payload = makeHuaweiMessageBody(envelope);
  assert.deepEqual(payload.message.token, ["opaque-token"]);
  assert.equal(payload.message.android.urgency, "HIGH");
  const data = JSON.parse(payload.message.data);
  assert.equal(data.deliveryId, "delivery-123");
  assert.equal(data.kind, "approval");
});

test("rejects unknown providers and malformed notifications", () => {
  assert.throws(() =>
    normalizeGatewayEnvelope({
      ...rawEnvelope,
      device: { ...rawEnvelope.device, pushProvider: "unknown" },
    }),
  );
  assert.throws(() =>
    normalizeGatewayEnvelope({
      ...rawEnvelope,
      notification: { ...rawEnvelope.notification, title: "" },
    }),
  );
});
