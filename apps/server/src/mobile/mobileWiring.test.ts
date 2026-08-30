import { describe, expect, it } from "vitest";

import { MobileDeviceRegistryLive } from "./Layers/MobileDeviceRegistry";
import { PushDeliveryLive } from "./Layers/PushDelivery";
import { migrationEntries } from "../persistence/Migrations";

describe("mobile push wiring", () => {
  it("registers the mobile push device migration after existing schema migrations", () => {
    expect(migrationEntries.at(-1)?.[0]).toBe(21);
    expect(migrationEntries.at(-1)?.[1]).toBe("MobilePushDevices");
  });

  it("exports registry and delivery layers for server runtime composition", () => {
    expect(MobileDeviceRegistryLive).toBeDefined();
    expect(PushDeliveryLive).toBeDefined();
  });
});
