import type {
  MobileDeviceRegistration,
  MobileDeviceRegistrationInput,
} from "@codeforge/contracts";
import { Effect, Schema, ServiceMap } from "effect";

export class MobileDeviceRegistryError extends Schema.TaggedErrorClass<MobileDeviceRegistryError>()(
  "MobileDeviceRegistryError",
  {
    operation: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export interface MobileDeviceRegistryShape {
  readonly register: (
    input: MobileDeviceRegistrationInput,
  ) => Effect.Effect<MobileDeviceRegistration, MobileDeviceRegistryError>;
  readonly unregister: (deviceId: string) => Effect.Effect<void, MobileDeviceRegistryError>;
  readonly get: (
    deviceId: string,
  ) => Effect.Effect<MobileDeviceRegistration | null, MobileDeviceRegistryError>;
  readonly list: () => Effect.Effect<readonly MobileDeviceRegistration[], MobileDeviceRegistryError>;
}

export class MobileDeviceRegistry extends ServiceMap.Service<
  MobileDeviceRegistry,
  MobileDeviceRegistryShape
>()("codeforge/mobile/MobileDeviceRegistry") {}
