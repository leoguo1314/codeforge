import { createHash, randomBytes } from "node:crypto";

import type {
  MobilePairingCreateResult,
  MobilePairingRedeemResult,
} from "@codeforge/contracts";
import { Effect, Layer, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { MobilePairing, MobilePairingError } from "../Services/MobilePairing.ts";

const PAIRING_CODE_TTL_MS = 2 * 60 * 1000;
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const hashSecret = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("base64url");

const InsertCodeRequest = Schema.Struct({
  codeHash: Schema.String,
  createdAt: Schema.String,
  expiresAt: Schema.String,
});
const RedeemCodeRequest = Schema.Struct({
  codeHash: Schema.String,
  redeemedAt: Schema.String,
  deviceId: Schema.String,
});
const RedeemCodeRow = Schema.Struct({ codeHash: Schema.String });
const InsertSessionRequest = Schema.Struct({
  tokenHash: Schema.String,
  deviceId: Schema.String,
  deviceLabel: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  expiresAt: Schema.String,
});
const ValidateSessionRequest = Schema.Struct({
  tokenHash: Schema.String,
  now: Schema.String,
});
const SessionRow = Schema.Struct({ tokenHash: Schema.String });
const TouchSessionRequest = Schema.Struct({ tokenHash: Schema.String, lastUsedAt: Schema.String });

const pairingError = (operation: string, message: string) => (cause: unknown) =>
  new MobilePairingError({ operation, message, cause });

const makeMobilePairing = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const insertCode = SqlSchema.void({
    Request: InsertCodeRequest,
    execute: ({ codeHash, createdAt, expiresAt }) => sql`
      INSERT INTO mobile_pairing_codes (code_hash, created_at, expires_at)
      VALUES (${codeHash}, ${createdAt}, ${expiresAt})
    `,
  });

  const redeemCodeRow = SqlSchema.findAll({
    Request: RedeemCodeRequest,
    Result: RedeemCodeRow,
    execute: ({ codeHash, redeemedAt, deviceId }) => sql`
      UPDATE mobile_pairing_codes
      SET redeemed_at = ${redeemedAt}, device_id = ${deviceId}
      WHERE code_hash = ${codeHash}
        AND redeemed_at IS NULL
        AND expires_at > ${redeemedAt}
      RETURNING code_hash AS "codeHash"
    `,
  });

  const insertSession = SqlSchema.void({
    Request: InsertSessionRequest,
    execute: ({ tokenHash, deviceId, deviceLabel, createdAt, expiresAt }) => sql`
      INSERT INTO mobile_auth_sessions (
        token_hash,
        device_id,
        device_label,
        created_at,
        expires_at,
        last_used_at,
        revoked_at
      ) VALUES (
        ${tokenHash},
        ${deviceId},
        ${deviceLabel},
        ${createdAt},
        ${expiresAt},
        ${createdAt},
        NULL
      )
    `,
  });

  const findSession = SqlSchema.findAll({
    Request: ValidateSessionRequest,
    Result: SessionRow,
    execute: ({ tokenHash, now }) => sql`
      SELECT token_hash AS "tokenHash"
      FROM mobile_auth_sessions
      WHERE token_hash = ${tokenHash}
        AND revoked_at IS NULL
        AND expires_at > ${now}
      LIMIT 1
    `,
  });

  const touchSession = SqlSchema.void({
    Request: TouchSessionRequest,
    execute: ({ tokenHash, lastUsedAt }) => sql`
      UPDATE mobile_auth_sessions
      SET last_used_at = ${lastUsedAt}
      WHERE token_hash = ${tokenHash}
    `,
  });

  const createCode = () =>
    Effect.gen(function* () {
      const code = randomBytes(12).toString("base64url");
      const now = new Date();
      const createdAt = now.toISOString();
      const expiresAt = new Date(now.getTime() + PAIRING_CODE_TTL_MS).toISOString();

      // Pairing codes are tiny and ephemeral; opportunistically remove expired rows.
      yield* sql`DELETE FROM mobile_pairing_codes WHERE expires_at <= ${createdAt}`.pipe(
        Effect.mapError(pairingError("MobilePairing.cleanup", "Failed to clean expired pairing codes.")),
      );
      yield* insertCode({ codeHash: hashSecret(code), createdAt, expiresAt }).pipe(
        Effect.mapError(pairingError("MobilePairing.createCode", "Failed to create pairing code.")),
      );
      return { code, expiresAt } satisfies MobilePairingCreateResult;
    });

  const redeemCode = (input: {
    readonly code: string;
    readonly deviceId: string;
    readonly deviceLabel: string | null;
  }) =>
    Effect.gen(function* () {
      const now = new Date();
      const redeemedAt = now.toISOString();
      const consumed = yield* redeemCodeRow({
        codeHash: hashSecret(input.code.trim()),
        redeemedAt,
        deviceId: input.deviceId,
      }).pipe(
        Effect.mapError(
          pairingError("MobilePairing.redeemCode.consume", "Failed to redeem pairing code."),
        ),
      );
      if (consumed.length === 0) {
        return yield* new MobilePairingError({
          operation: "MobilePairing.redeemCode",
          message: "Pairing code is invalid, expired, or already used.",
        });
      }

      const sessionToken = randomBytes(32).toString("base64url");
      const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
      yield* insertSession({
        tokenHash: hashSecret(sessionToken),
        deviceId: input.deviceId,
        deviceLabel: input.deviceLabel,
        createdAt: redeemedAt,
        expiresAt,
      }).pipe(
        Effect.mapError(
          pairingError("MobilePairing.redeemCode.session", "Failed to create mobile session."),
        ),
      );

      return { sessionToken, expiresAt } satisfies MobilePairingRedeemResult;
    });

  const validateSessionToken = (token: string) =>
    Effect.gen(function* () {
      const normalized = token.trim();
      if (!normalized) return false;
      const now = new Date().toISOString();
      const tokenHash = hashSecret(normalized);
      const rows = yield* findSession({ tokenHash, now }).pipe(
        Effect.mapError(
          pairingError("MobilePairing.validate", "Failed to validate mobile session."),
        ),
      );
      if (rows.length === 0) return false;
      yield* touchSession({ tokenHash, lastUsedAt: now }).pipe(
        Effect.mapError(pairingError("MobilePairing.touch", "Failed to update mobile session.")),
      );
      return true;
    });

  return { createCode, redeemCode, validateSessionToken };
});

export const MobilePairingLive = Layer.effect(MobilePairing, makeMobilePairing);
