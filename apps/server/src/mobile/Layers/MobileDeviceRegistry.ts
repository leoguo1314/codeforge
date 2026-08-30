import {
  MobileDeviceRegistration,
  type MobileDeviceRegistrationInput,
} from "@codeforge/contracts";
import { Effect, Layer, Option, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  MobileDeviceRegistry,
  MobileDeviceRegistryError,
  type MobileDeviceRegistryShape,
} from "../Services/MobileDeviceRegistry.ts";

const DeviceIdRequest = Schema.Struct({ deviceId: Schema.String });

const toRegistryError = (operation: string) => (cause: unknown) =>
  new MobileDeviceRegistryError({ operation, cause });

const makeMobileDeviceRegistry = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: MobileDeviceRegistration,
    execute: (row) => sql`
      INSERT INTO mobile_push_devices (
        device_id,
        platform,
        push_provider,
        push_token,
        app_version,
        device_label,
        registered_at,
        updated_at
      )
      VALUES (
        ${row.deviceId},
        ${row.platform},
        ${row.pushProvider},
        ${row.pushToken},
        ${row.appVersion},
        ${row.deviceLabel},
        ${row.registeredAt},
        ${row.updatedAt}
      )
      ON CONFLICT (device_id)
      DO UPDATE SET
        platform = excluded.platform,
        push_provider = excluded.push_provider,
        push_token = excluded.push_token,
        app_version = excluded.app_version,
        device_label = excluded.device_label,
        updated_at = excluded.updated_at
    `,
  });

  const getRow = SqlSchema.findOneOption({
    Request: DeviceIdRequest,
    Result: MobileDeviceRegistration,
    execute: ({ deviceId }) => sql`
      SELECT
        device_id AS "deviceId",
        platform,
        push_provider AS "pushProvider",
        push_token AS "pushToken",
        app_version AS "appVersion",
        device_label AS "deviceLabel",
        registered_at AS "registeredAt",
        updated_at AS "updatedAt"
      FROM mobile_push_devices
      WHERE device_id = ${deviceId}
    `,
  });

  const listRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: MobileDeviceRegistration,
    execute: () => sql`
      SELECT
        device_id AS "deviceId",
        platform,
        push_provider AS "pushProvider",
        push_token AS "pushToken",
        app_version AS "appVersion",
        device_label AS "deviceLabel",
        registered_at AS "registeredAt",
        updated_at AS "updatedAt"
      FROM mobile_push_devices
      ORDER BY updated_at DESC, device_id ASC
    `,
  });

  const deleteRow = SqlSchema.void({
    Request: DeviceIdRequest,
    execute: ({ deviceId }) => sql`
      DELETE FROM mobile_push_devices
      WHERE device_id = ${deviceId}
    `,
  });

  const get: MobileDeviceRegistryShape["get"] = (deviceId) =>
    getRow({ deviceId }).pipe(
      Effect.mapError(toRegistryError("MobileDeviceRegistry.get")),
      Effect.map((result) => Option.getOrNull(result)),
    );

  const register: MobileDeviceRegistryShape["register"] = (
    input: MobileDeviceRegistrationInput,
  ) =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      const existing = yield* get(input.deviceId);
      const registration: MobileDeviceRegistration = {
        ...input,
        registeredAt: existing?.registeredAt ?? now,
        updatedAt: now,
      };
      yield* upsertRow(registration).pipe(
        Effect.mapError(toRegistryError("MobileDeviceRegistry.register")),
      );
      return registration;
    });

  const unregister: MobileDeviceRegistryShape["unregister"] = (deviceId) =>
    deleteRow({ deviceId }).pipe(
      Effect.mapError(toRegistryError("MobileDeviceRegistry.unregister")),
    );

  const list: MobileDeviceRegistryShape["list"] = () =>
    listRows(undefined).pipe(Effect.mapError(toRegistryError("MobileDeviceRegistry.list")));

  return { register, unregister, get, list } satisfies MobileDeviceRegistryShape;
});

export const MobileDeviceRegistryLive = Layer.effect(
  MobileDeviceRegistry,
  makeMobileDeviceRegistry,
);
