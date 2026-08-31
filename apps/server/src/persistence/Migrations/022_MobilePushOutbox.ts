import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS mobile_push_outbox (
      delivery_id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      notification_json TEXT NOT NULL,
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT NOT NULL,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      delivered_at TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_mobile_push_outbox_due
    ON mobile_push_outbox(status, next_attempt_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_mobile_push_outbox_device
    ON mobile_push_outbox(device_id, created_at)
  `;
});
