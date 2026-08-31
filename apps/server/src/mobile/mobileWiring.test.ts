import { describe, expect, it } from "vitest";

import { MobileDeviceRegistryLive } from "./Layers/MobileDeviceRegistry";
import { PushDeliveryLive } from "./Layers/PushDelivery";
import { PushOutboxLive } from "./Layers/PushOutbox";
import { migrationEntries } from "../persistence/Migrations";

describe("mobile push wiring", () => {
  it("registers the durable mobile push migrations after existing schema migrations", () => {
    expect(migrationEntries.at(-2)?.[0]).toBe(21);
    expect(migrationEntries.at(-2)?.[1]).toBe("MobilePushDevices");
    expect(migrationEntries.at(-1)?.[0]).toBe(22);
    expect(migrationEntries.at(-1)?.[1]).toBe("MobilePushOutbox");
  });

  it("exports registry, outbox, and delivery layers for server runtime composition", () => {
    expect(MobileDeviceRegistryLive).toBeDefined();
    expect(PushOutboxLive).toBeDefined();
    expect(PushDeliveryLive).toBeDefined();
  });
});
