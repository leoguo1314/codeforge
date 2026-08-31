import { Schema } from "effect";

import { IsoDateTime, NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas";

export const MobileDevicePlatform = Schema.Literals(["android"]);
export type MobileDevicePlatform = typeof MobileDevicePlatform.Type;

/**
 * `none` means the installation is known to CodeForge but no background push
 * provider token is currently available. The other values identify the
 * delivery backend that owns the opaque token.
 */
export const MobilePushProvider = Schema.Literals(["none", "fcm", "huawei", "gateway"]);
export type MobilePushProvider = typeof MobilePushProvider.Type;

export const MobileDeviceRegistrationInput = Schema.Struct({
  deviceId: TrimmedNonEmptyString,
  platform: MobileDevicePlatform,
  pushProvider: MobilePushProvider,
  pushToken: Schema.NullOr(TrimmedNonEmptyString),
  appVersion: TrimmedNonEmptyString,
  deviceLabel: Schema.NullOr(TrimmedNonEmptyString),
});
export type MobileDeviceRegistrationInput = typeof MobileDeviceRegistrationInput.Type;

export const MobileDeviceRegistration = Schema.Struct({
  ...MobileDeviceRegistrationInput.fields,
  registeredAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type MobileDeviceRegistration = typeof MobileDeviceRegistration.Type;

export const MobileRegisterDeviceResult = Schema.Struct({
  registration: MobileDeviceRegistration,
});
export type MobileRegisterDeviceResult = typeof MobileRegisterDeviceResult.Type;

export const MobileUnregisterDeviceInput = Schema.Struct({
  deviceId: TrimmedNonEmptyString,
});
export type MobileUnregisterDeviceInput = typeof MobileUnregisterDeviceInput.Type;

export const MobileUnregisterDeviceResult = Schema.Struct({
  deviceId: TrimmedNonEmptyString,
});
export type MobileUnregisterDeviceResult = typeof MobileUnregisterDeviceResult.Type;

export const MobileGetPushStatusInput = Schema.Struct({
  deviceId: TrimmedNonEmptyString,
});
export type MobileGetPushStatusInput = typeof MobileGetPushStatusInput.Type;

export const MobilePushDeliveryAdapterKind = Schema.Literals(["disabled", "http-gateway"]);
export type MobilePushDeliveryAdapterKind = typeof MobilePushDeliveryAdapterKind.Type;

export const MobilePushOutboxStats = Schema.Struct({
  pending: NonNegativeInt,
  retry: NonNegativeInt,
  dead: NonNegativeInt,
  delivered: NonNegativeInt,
});
export type MobilePushOutboxStats = typeof MobilePushOutboxStats.Type;

export const MobilePushServerStatus = Schema.Struct({
  configured: Schema.Boolean,
  adapter: MobilePushDeliveryAdapterKind,
  registeredDevices: NonNegativeInt,
  pushCapableDevices: NonNegativeInt,
  outbox: MobilePushOutboxStats,
});
export type MobilePushServerStatus = typeof MobilePushServerStatus.Type;

export const MobileGetPushStatusResult = Schema.Struct({
  registration: Schema.NullOr(MobileDeviceRegistration),
  server: MobilePushServerStatus,
});
export type MobileGetPushStatusResult = typeof MobileGetPushStatusResult.Type;

export const MobileSendTestNotificationInput = Schema.Struct({
  deviceId: TrimmedNonEmptyString,
});
export type MobileSendTestNotificationInput = typeof MobileSendTestNotificationInput.Type;

export const MobileSendTestNotificationResult = Schema.Struct({
  queued: Schema.Boolean,
});
export type MobileSendTestNotificationResult = typeof MobileSendTestNotificationResult.Type;

export const MobileReplayDeadPushInput = Schema.Struct({
  deliveryId: TrimmedNonEmptyString,
});
export type MobileReplayDeadPushInput = typeof MobileReplayDeadPushInput.Type;

export const MobileReplayDeadPushResult = Schema.Struct({
  deliveryId: TrimmedNonEmptyString,
  replayed: Schema.Boolean,
});
export type MobileReplayDeadPushResult = typeof MobileReplayDeadPushResult.Type;
