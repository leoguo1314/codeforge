import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS mobile_pairing_codes (
      code_hash TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      redeemed_at TEXT,
      device_id TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_mobile_pairing_codes_expiry
    ON mobile_pairing_codes(expires_at, redeemed_at)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS mobile_auth_sessions (
      token_hash TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      device_label TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL,
      revoked_at TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_mobile_auth_sessions_device
    ON mobile_auth_sessions(device_id, expires_at)
  `;
});
