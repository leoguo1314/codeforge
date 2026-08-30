import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS mobile_push_devices (
      device_id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      push_provider TEXT NOT NULL,
      push_token TEXT,
      app_version TEXT NOT NULL,
      device_label TEXT,
      registered_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_mobile_push_devices_provider
    ON mobile_push_devices(push_provider)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_mobile_push_devices_updated_at
    ON mobile_push_devices(updated_at)
  `;
});
