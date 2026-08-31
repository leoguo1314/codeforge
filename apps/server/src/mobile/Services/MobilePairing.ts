import type {
  MobilePairingCreateResult,
  MobilePairingRedeemInput,
  MobilePairingRedeemResult,
} from "@codeforge/contracts";
import { Effect, Schema, ServiceMap } from "effect";

export class MobilePairingError extends Schema.TaggedErrorClass<MobilePairingError>()(
  "MobilePairingError",
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export interface MobilePairingShape {
  readonly createCode: () => Effect.Effect<MobilePairingCreateResult, MobilePairingError>;
  readonly redeemCode: (
    input: MobilePairingRedeemInput,
  ) => Effect.Effect<MobilePairingRedeemResult, MobilePairingError>;
  readonly validateSessionToken: (token: string) => Effect.Effect<boolean, MobilePairingError>;
}

export class MobilePairing extends ServiceMap.Service<MobilePairing, MobilePairingShape>()(
  "codeforge/mobile/MobilePairing",
) {}
