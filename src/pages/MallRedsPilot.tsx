/**
 * MallRedsPilot.tsx — standalone mount of the shared wayfinding experience at
 * /pilot, kept for controlled testing (no app shell, no bottom nav). The same
 * component powers the shopper Navigate tab (see NavigateScreen.tsx), so the
 * two can never diverge. Accepts the same QR-ready link parameters:
 *
 *   /pilot?mall=mallreds-pilot&start=entrance-main   or   /pilot?mall=menlyn-park
 */

import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import WayfindingPilot from "@/components/navigation/WayfindingPilot";
import { parseWayfindingAnchor } from "@/components/navigation/wayfindingAnchor";
import { DEFAULT_WAYFINDING_MALL_ID } from "@/components/navigation/mallDatasets";

export default function MallRedsPilot() {
  const { search } = useLocation();
  const parsed = useMemo(() => parseWayfindingAnchor(search), [search]);

  return (
    <WayfindingPilot
      mallId={parsed.mallId ?? DEFAULT_WAYFINDING_MALL_ID}
      initialAnchor={parsed.status === "ok" ? parsed.anchor : null}
      anchorNotice={parsed.status === "invalid" ? parsed.reason : null}
    />
  );
}
