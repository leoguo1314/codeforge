import { useEffect } from "react";

import { isAndroidApp, readAndroidDeviceRegistration } from "../androidBridge";
import { ensureNativeApi } from "../nativeApi";
import { WS_TRANSPORT_STATE_EVENT, type TransportState } from "../wsTransport";

/**
 * Keeps one Android installation registered with the CodeForge Server.
 * Registration is idempotent and is refreshed whenever the WebSocket becomes
 * open, which also naturally handles provider-token refreshes in a future
 * native FCM/Huawei implementation.
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

    const onTransportState = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const state = event.detail as TransportState | undefined;
      if (state !== "open") return;
      lastSignature = "";
      void register();
    };

    window.addEventListener(WS_TRANSPORT_STATE_EVENT, onTransportState);
    return () => {
      disposed = true;
      window.removeEventListener(WS_TRANSPORT_STATE_EVENT, onTransportState);
    };
  }, []);

  return null;
}
