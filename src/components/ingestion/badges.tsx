/**
 * Compact status badges for the ingestion admin — trust, availability and
 * freshness — all driven by the shared label metadata so the UI never invents
 * its own wording.
 */

import { cn } from "@/lib/utils";
import type { PriceTrustLabel, AvailabilityLabel, ProductOffer } from "@/lib/ingestion/model";
import { trustMeta, availabilityMeta, type BadgeTone } from "@/lib/ingestion/labels";
import { computeEffectiveFreshness, type FreshnessState } from "@/lib/ingestion/freshness";

const TONE: Record<BadgeTone, string> = {
  verified: "bg-secondary/15 text-secondary border-secondary/40",
  fresh: "bg-primary/15 text-primary border-primary/40",
  special: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/40",
  info: "bg-sky-500/15 text-sky-300 border-sky-500/40",
  muted: "bg-muted text-muted-foreground border-border",
  warning: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  danger: "bg-red-500/15 text-red-300 border-red-500/40",
};

export function ToneBadge({ tone, children, title }: { tone: BadgeTone; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap", TONE[tone])}>
      {children}
    </span>
  );
}

export function TrustBadge({ label }: { label: PriceTrustLabel }) {
  const m = trustMeta(label);
  return <ToneBadge tone={m.tone} title={m.description}>{m.label}</ToneBadge>;
}

export function AvailabilityBadge({ label }: { label: AvailabilityLabel }) {
  const m = availabilityMeta(label);
  return <ToneBadge tone={m.tone} title={m.description}>{m.label}</ToneBadge>;
}

const FRESH_TONE: Record<FreshnessState, BadgeTone> = {
  fresh: "fresh", aging: "warning", stale: "warning", expired: "danger", unpublished: "muted", unavailable: "danger",
};
const FRESH_LABEL: Record<FreshnessState, string> = {
  fresh: "Fresh", aging: "Aging", stale: "Stale", expired: "Expired", unpublished: "Unpublished", unavailable: "Unavailable",
};

export function FreshnessBadge({ offer, nowMs }: { offer: ProductOffer; nowMs: number }) {
  const f = computeEffectiveFreshness(offer, nowMs);
  return <ToneBadge tone={FRESH_TONE[f.state]} title={f.reason}>{FRESH_LABEL[f.state]}</ToneBadge>;
}

export function PublishedBadge({ published, reviewStatus }: { published: boolean; reviewStatus: string }) {
  if (published) return <ToneBadge tone="verified">Published</ToneBadge>;
  if (reviewStatus === "rejected") return <ToneBadge tone="danger">Rejected</ToneBadge>;
  if (reviewStatus === "needs_correction") return <ToneBadge tone="warning">Needs correction</ToneBadge>;
  return <ToneBadge tone="muted">Review required</ToneBadge>;
}
