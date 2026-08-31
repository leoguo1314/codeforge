import { useEffect } from "react";

import {
  isAndroidApp,
  onAndroidPushRegistrationChanged,
  readAndroidDeviceRegistration,
} from "../androidBridge";
import { ensureNativeApi } from "../nativeApi";
import { WS_TRANSPORT_STATE_EVENT, type TransportState } from "../wsTransport";

/**
 * Keeps one Android installation registered with the CodeForge Server.
 * Registration is idempotent and refreshed both when WebSocket connectivity is
 * restored and when the native push provider rotates its opaque device token.
 */
export function AndroidDeviceRegistration() {
  useEffect(() => {
    if (!isAndroidApp()) return;

    let disposed = false;
    let lastSignature = "";

    const register = async () => {
      if (disposed) return;
      const registration = readAndroidDeviceRegistration();
      if (!registration) return;

      const signature = JSON.stringify(registration);
      if (signature === lastSignature) return;

      try {
        await ensureNativeApi().mobile.registerDevice(registration);
        if (!disposed) lastSignature = signature;
      } catch {
        // Connection lifecycle will retry on the next open event. Registration
        // failure must not interrupt the workspace UI.
      }
    };

    void register();

    const refreshRegistration = () => {
      lastSignature = "";
      void register();
    };

    const onTransportState = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const state = event.detail as TransportState | undefined;
      if (state !== "open") return;
      refreshRegistration();
    };

    window.addEventListener(WS_TRANSPORT_STATE_EVENT, onTransportState);
    const unsubscribePushRegistration = onAndroidPushRegistrationChanged(refreshRegistration);
    return () => {
      disposed = true;
      unsubscribePushRegistration();
      window.removeEventListener(WS_TRANSPORT_STATE_EVENT, onTransportState);
    };
  }, []);

  return null;
}
