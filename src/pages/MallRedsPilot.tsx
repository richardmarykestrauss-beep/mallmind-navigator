/**
 * MallRedsPilot.tsx — standalone mount of the shared wayfinding experience at
 * /pilot, kept for controlled testing (no app shell, no bottom nav). The same
 * component powers the shopper Navigate tab (see NavigateScreen.tsx), so the
 * two can never diverge. Accepts the same QR-ready link parameters:
 *
 *   /pilot?mall=mallreds-pilot&start=entrance-main
 */

import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import WayfindingPilot from "@/components/navigation/WayfindingPilot";
import { parseWayfindingAnchor } from "@/components/navigation/wayfindingAnchor";

export default function MallRedsPilot() {
  const { search } = useLocation();
  const parsed = useMemo(() => parseWayfindingAnchor(search), [search]);

  return (
    <WayfindingPilot
      initialAnchor={parsed.status === "ok" ? parsed.anchor : null}
      anchorNotice={parsed.status === "invalid" ? parsed.reason : null}
    />
  );
}
