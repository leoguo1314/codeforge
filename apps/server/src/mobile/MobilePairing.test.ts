import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";

import * as SqliteClient from "../persistence/NodeSqliteClient.ts";
import Migration0023 from "../persistence/Migrations/023_MobilePairingSessions.ts";
import { MobilePairingLive } from "./Layers/MobilePairing.ts";
import { MobilePairing } from "./Services/MobilePairing.ts";

const sqliteLayer = SqliteClient.layerMemory();
const pairingLayer = MobilePairingLive.pipe(Layer.provide(sqliteLayer));
const testLayer = Layer.merge(sqliteLayer, pairingLayer);

describe("MobilePairing", () => {
  it("redeems a one-time code once and validates the resulting session", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* Migration0023;
        const pairing = yield* MobilePairing;

        const created = yield* pairing.createCode();
        expect(created.code.length).toBeGreaterThanOrEqual(16);
        expect(Date.parse(created.expiresAt)).toBeGreaterThan(Date.now());

        const redeemed = yield* pairing.redeemCode({
          code: created.code,
          deviceId: "android-installation-test",
          deviceLabel: "Test Android",
        });
        expect(redeemed.sessionToken).not.toBe(created.code);
        expect(yield* pairing.validateSessionToken(redeemed.sessionToken)).toBe(true);
        expect(yield* pairing.validateSessionToken("definitely-not-a-session-token")).toBe(false);

        const secondRedeem = yield* Effect.exit(
          pairing.redeemCode({
            code: created.code,
            deviceId: "another-device",
            deviceLabel: null,
          }),
        );
        expect(secondRedeem._tag).toBe("Failure");
      }).pipe(Effect.provide(testLayer), Effect.scoped),
    );
  });
});
