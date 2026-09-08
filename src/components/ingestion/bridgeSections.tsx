/**
 * Sprint 2A — Evidence-to-Offer bridge: Data Command Center views.
 *
 * Extraction Review Queue, Evidence Comparison, a Review Drawer (approve/reject/
 * request-changes/archive with explicit corrections), and Publication Readiness.
 * Actions run the deterministic bridge and persist both the fabric and ingestion
 * prototype stores. No dead buttons; nothing publishes without an approved,
 * evidence-backed, publication-eligible decision.
 */

import { useMemo, useState } from "react";
import { ClipboardList, GitCompare, Rocket, CheckCircle2, XCircle, PencilLine, Archive, ShieldCheck, Filter } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ToneBadge } from "@/components/ingestion/badges";
import { PRICE_TRUST_LABELS, AVAILABILITY_STATUS_LABELS } from "@/lib/ingestion/labels";
import { relativeAge } from "@/lib/ingestion/freshness";
import { loadDatabase, saveDatabase } from "@/lib/ingestion/store";
import { loadFabric, saveFabric } from "@/lib/fabric/store";
import { approvalBlockers, ReviewValidationError, type DecisionInput } from "@/lib/fabric/review";
import { submitDecision } from "@/lib/fabric/bridgeStore";
import { offerPublication } from "@/lib/fabric/assistantSafe";
import { getShopperEligibleOffers } from "@/lib/fabric/recommendationSpine";
import { GEOGRAPHIC_SCOPES } from "@/lib/fabric/types";
import type { OfferDraft, FabricDatabase, EvidenceRecord, FieldPatch, SourceAccessPolicy, ReviewDecisionType } from "@/lib/fabric/types";
import type { IngestionDatabase, AvailabilityStatus, PriceTrustLabel, GeographicScope } from "@/lib/ingestion/model";

const inputCls = "w-full rounded-lg border border-border bg-background/60 px-2 py-1 text-xs outline-none focus:border-primary/60";

export const BRIDGE_SECTIONS = [
  { id: "review-queue", label: "Extraction Review Queue" },
  { id: "publication", label: "Publication Readiness" },
  { id: "spine", label: "Recommendation Spine" },
] as const;

function SectionCard({ id, icon, title, count, children }: { id: string; icon: React.ReactNode; title: string; count?: number; children: React.ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-4 border-border/70 bg-surface/40">
      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm">{icon} {title}{count != null && <span className="text-muted-foreground">({count})</span>}</CardTitle></CardHeader>
      <CardContent className="p-0">{children}</CardContent>
    </Card>
  );
}
const Empty = ({ children }: { children: React.ReactNode }) => <p className="px-4 py-6 text-center text-sm text-muted-foreground">{children}</p>;

/** Normalize an evidence record's payload into comparable {field,value} rows. */
function evidenceFields(e: EvidenceRecord): { field: string; value: string }[] {
  const sd = e.structuredData;
  if (sd && Array.isArray((sd as { fields?: unknown }).fields)) {
    return ((sd as { fields: { field: string; value: unknown }[] }).fields).map((f) => ({ field: f.field, value: String(f.value) }));
  }
  if (sd) return Object.entries(sd).map(([field, value]) => ({ field, value: String(value) }));
  return [];
}

export function BridgePanels({ resolveProductName, nowMs }: { resolveProductName: (productId: string) => string; nowMs: number }) {
  const [fabric, setFabric] = useState<FabricDatabase>(() => loadFabric());
  const [ingestion, setIngestion] = useState<IngestionDatabase>(() => loadDatabase());
  const [reviewDraftId, setReviewDraftId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const persist = (f: FabricDatabase, i: IngestionDatabase) => { saveFabric(f); saveDatabase(i); setFabric(f); setIngestion(i); };

  const queue = fabric.drafts;
  const bridgeOffers = ingestion.offers.filter((o) => o.reviewStatus === "approved" && (o.draftId || fabric.provenance.some((l) => l.entityType === "product_offer" && l.entityId === o.id)));

  const reviewDraft = reviewDraftId ? fabric.drafts.find((d) => d.id === reviewDraftId) ?? null : null;

  const submit = (draftId: string, input: DecisionInput) => {
    try {
      const res = submitDecision(fabric, ingestion, draftId, input, new Date().toISOString());
      persist(res.fabric, res.ingestion);
      if (res.offer) setMsg(`Draft ${draftId}: ${input.decision} → offer ${res.offer.id.slice(0, 18)} ${res.offer.published ? "PUBLISHED" : "approved (publication blocked: " + (res.publication?.blockers.join(", ") || "n/a") + ")"}.`);
      else setMsg(`Draft ${draftId}: ${input.decision} recorded. No offer created.`);
      setReviewDraftId(null);
    } catch (e) {
      if (e instanceof ReviewValidationError) setMsg(`Approval blocked: ${e.blockers.join(", ")}.`);
      else setMsg(`Error: ${(e as Error).message}`);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between gap-2 px-1">
        <p className="text-[11px] text-muted-foreground">Evidence → offer bridge — every offer is evidence-backed and human-approved. Nothing publishes without an eligible decision.</p>
      </div>
      {msg && <div className="mx-1 rounded-lg border border-secondary/40 bg-secondary/10 px-3 py-2 text-xs text-secondary">{msg}</div>}

      {/* A — Extraction Review Queue */}
      <SectionCard id="review-queue" icon={<ClipboardList className="h-4 w-4 text-amber-300" />} title="Extraction Review Queue" count={queue.length}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border/60">
                <th className="px-4 py-2">Draft / Product</th><th className="px-4 py-2">Source</th><th className="px-4 py-2">Adapter</th><th className="px-4 py-2">Price</th>
                <th className="px-4 py-2">Evidence</th><th className="px-4 py-2">Confidence</th><th className="px-4 py-2">Warnings</th><th className="px-4 py-2">Conflict</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {queue.length === 0 && <tr><td colSpan={10}><Empty>No drafts awaiting review.</Empty></td></tr>}
              {queue.map((d) => (
                <tr key={d.id} className="border-b border-border/40 align-top">
                  <td className="px-4 py-2"><p className="font-medium">{d.productTitle}</p><p className="text-[11px] text-muted-foreground">{d.id.slice(0, 20)}</p></td>
                  <td className="px-4 py-2 text-xs">{d.retailerName ?? d.sourceId}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{d.adapterId}</td>
                  <td className="px-4 py-2 font-semibold">R{d.price.toLocaleString("en-ZA")}</td>
                  <td className="px-4 py-2 text-xs">{d.evidenceIds.length}</td>
                  <td className="px-4 py-2"><ConfidenceMini c={d.confidence} /></td>
                  <td className="px-4 py-2">{d.warnings.length > 0 ? <ToneBadge tone="warning" title={d.warnings.join("; ")}>{d.warnings.length}</ToneBadge> : <span className="text-[11px] text-muted-foreground">—</span>}</td>
                  <td className="px-4 py-2">{d.conflictState === "conflict_detected" ? <ToneBadge tone="danger">Conflict</ToneBadge> : d.conflictState === "resolved" ? <ToneBadge tone="muted">Resolved</ToneBadge> : <span className="text-[11px] text-muted-foreground">—</span>}</td>
                  <td className="px-4 py-2"><ToneBadge tone={d.reviewStatus === "approved" ? "verified" : d.reviewStatus === "rejected" ? "danger" : d.reviewStatus === "archived" ? "muted" : "warning"}>{d.reviewStatus.replace(/_/g, " ")}</ToneBadge></td>
                  <td className="px-4 py-2"><Button variant="neon" size="sm" onClick={() => setReviewDraftId(d.id)}><PencilLine className="h-3.5 w-3.5" /> Review</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* D — Publication Readiness */}
      <SectionCard id="publication" icon={<Rocket className="h-4 w-4 text-primary" />} title="Publication Readiness" count={bridgeOffers.length}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border/60">
                <th className="px-4 py-2">Offer / Product</th><th className="px-4 py-2">Price</th><th className="px-4 py-2">Eligibility</th><th className="px-4 py-2">Blockers</th><th className="px-4 py-2">Warnings</th><th className="px-4 py-2">Evidence lineage</th>
              </tr>
            </thead>
            <tbody>
              {bridgeOffers.length === 0 && <tr><td colSpan={6}><Empty>No evidence-backed offers yet — approve a draft above.</Empty></td></tr>}
              {bridgeOffers.map((o) => {
                const pub = offerPublication(o, fabric, nowMs);
                const lineage = Array.from(new Set([...(o.evidenceIds ?? []), ...fabric.provenance.filter((l) => l.entityType === "product_offer" && l.entityId === o.id).map((l) => l.evidenceId)]));
                return (
                  <tr key={o.id} className="border-b border-border/40 align-top">
                    <td className="px-4 py-2"><p className="font-medium">{resolveProductName(o.productId)}</p><p className="text-[11px] text-muted-foreground">{o.id.slice(0, 20)}{o.published ? " · published" : ""}</p></td>
                    <td className="px-4 py-2 font-semibold">R{o.currentPrice.toLocaleString("en-ZA")}</td>
                    <td className="px-4 py-2"><ToneBadge tone={pub.eligible ? "verified" : "danger"}>{pub.eligible ? "Eligible" : "Blocked"}</ToneBadge></td>
                    <td className="px-4 py-2 max-w-[220px] text-[11px] text-red-300">{pub.blockers.map((b) => b.replace(/_/g, " ")).join(", ") || "—"}</td>
                    <td className="px-4 py-2 max-w-[220px] text-[11px] text-amber-300">{pub.warnings.map((w) => w.replace(/_/g, " ")).join(", ") || "—"}</td>
                    <td className="px-4 py-2 text-[11px] text-muted-foreground">{lineage.length} evidence{o.reviewDecisionId ? ` · decision ${o.reviewDecisionId.slice(0, 10)}` : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* Recommendation Spine — governed retrieval diagnostics (admin only) */}
      <SectionCard id="spine" icon={<Filter className="h-4 w-4 text-primary" />} title="Recommendation Spine — normal-mode retrieval">
        {(() => {
          const { diagnostics: g } = getShopperEligibleOffers(ingestion, fabric, { mallId: ingestion.malls[0]?.id ?? "mall_reds", category: "television", budget: 4000 }, nowMs, "normal");
          return (
            <div className="space-y-2 p-4">
              <p className="text-[11px] text-muted-foreground">Sample query “TV under R4000 at {ingestion.malls[0]?.name ?? "the mall"}” — the NORMAL shopper path only returns governed eligible offers. Diagnostics are admin-only and never shown to shoppers.</p>
              <div className="flex flex-wrap gap-2 text-[11px]">
                <ToneBadge tone="muted">Considered {g.totalConsidered}</ToneBadge>
                <ToneBadge tone="verified">Eligible {g.eligible}</ToneBadge>
                <ToneBadge tone="warning">Review {g.excludedByReview}</ToneBadge>
                <ToneBadge tone="warning">Publication {g.excludedByPublication}</ToneBadge>
                <ToneBadge tone="warning">Stale/expired {g.excludedStaleExpired}</ToneBadge>
                <ToneBadge tone="warning">Unavailable {g.excludedUnavailable}</ToneBadge>
                <ToneBadge tone="danger">Conflict {g.excludedConflict}</ToneBadge>
                <ToneBadge tone="warning">No evidence {g.excludedMissingEvidence}</ToneBadge>
                <ToneBadge tone="muted">Mall/store {g.excludedMallStoreMismatch}</ToneBadge>
              </div>
            </div>
          );
        })()}
      </SectionCard>

      {reviewDraft && (
        <ReviewDrawer
          draft={reviewDraft}
          evidence={reviewDraft.evidenceIds.map((id) => fabric.evidence.find((e) => e.id === id)).filter(Boolean) as EvidenceRecord[]}
          policy={fabric.policies.find((p) => p.sourceId === reviewDraft.sourceId)}
          nowMs={nowMs}
          onClose={() => setReviewDraftId(null)}
          onSubmit={(input) => submit(reviewDraft.id, input)}
        />
      )}
    </>
  );
}

function ConfidenceMini({ c }: { c: OfferDraft["confidence"] }) {
  const top: [string, number][] = [["id", c.identityConfidence], ["price", c.priceConfidence], ["avail", c.availabilityConfidence], ["auth", c.sourceAuthority]];
  return (
    <div className="flex gap-1.5">
      {top.map(([k, v]) => (
        <div key={k} className="text-center" title={`${k}: ${Math.round(v * 100)}%`}>
          <div className="h-6 w-2 overflow-hidden rounded bg-muted"><div className="w-full bg-primary" style={{ height: `${Math.round(v * 100)}%`, marginTop: `${100 - Math.round(v * 100)}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

// B + C — Review drawer (with side-by-side Evidence Comparison)
function ReviewDrawer({ draft, evidence, policy, nowMs, onClose, onSubmit }: {
  draft: OfferDraft; evidence: EvidenceRecord[]; policy: SourceAccessPolicy | undefined; nowMs: number;
  onClose: () => void; onSubmit: (input: DecisionInput) => void;
}) {
  const [decision, setDecision] = useState<ReviewDecisionType>("approve");
  const [finalTrustLabel, setFinalTrustLabel] = useState<PriceTrustLabel | "">("");
  const [availability, setAvailability] = useState<AvailabilityStatus | "">("");
  const [scope, setScope] = useState<GeographicScope | "">("");
  const [priceOverride, setPriceOverride] = useState<string>("");
  const [resolveConflict, setResolveConflict] = useState(false);
  const [reasoning, setReasoning] = useState("");

  const correctedFields: FieldPatch[] = [];
  if (priceOverride.trim() && Number(priceOverride) > 0 && Number(priceOverride) !== draft.price) correctedFields.push({ field: "price", from: draft.price, to: Number(priceOverride) });
  if (resolveConflict && draft.conflictState === "conflict_detected") correctedFields.push({ field: "conflictState", from: "conflict_detected", to: "resolved" });

  const input: DecisionInput = {
    reviewerId: "admin", decision,
    finalTrustLabel: finalTrustLabel || null,
    approvedAvailabilityStatus: availability || null,
    approvedGeographicScope: scope || null,
    correctedFields, reasoning,
  };
  const blockers = decision === "approve" ? approvalBlockers(draft, input, evidence, policy) : [];

  // Field values across evidence for conflict highlighting.
  const allFields = evidence.map(evidenceFields);
  const fieldNames = Array.from(new Set(allFields.flat().map((f) => f.field)));
  const conflictingFields = new Set(fieldNames.filter((name) => new Set(allFields.map((fs) => fs.find((f) => f.field === name)?.value).filter((v) => v != null)).size > 1));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><PencilLine className="h-4 w-4 text-primary" /> Review draft — {draft.productTitle}</DialogTitle></DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-border/60 bg-surface/40 p-3 text-xs text-muted-foreground">
            <span>Price: <b className="text-foreground">R{draft.price.toLocaleString("en-ZA")}</b></span>
            <span>Suggested trust: <b className="text-foreground">{PRICE_TRUST_LABELS[draft.suggestedTrustLabel].label}</b></span>
            <span>Availability: <b className="text-foreground">{draft.availabilityStatus}</b></span>
            <span>Scope: <b className="text-foreground">{draft.geographicScope}</b></span>
            <span>Observed: {relativeAge(draft.observedAt, nowMs)}</span>
            <span>Normalizer: v{draft.normalizerVersion}</span>
          </div>
          {draft.warnings.length > 0 && <p className="text-[11px] text-amber-300">Normalization warnings: {draft.warnings.join("; ")}</p>}

          {/* Evidence comparison */}
          <div>
            <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-muted-foreground"><GitCompare className="h-3.5 w-3.5" /> Evidence comparison ({evidence.length})</p>
            <div className="grid gap-2 md:grid-cols-2">
              {evidence.map((e) => (
                <div key={e.id} className="rounded-lg border border-border/60 bg-surface/30 p-2 text-[11px]">
                  <p className="font-medium text-foreground">{e.adapterId} v{e.adapterVersion}</p>
                  {e.sourceUrl && <a href={e.sourceUrl} target="_blank" rel="noreferrer" className="block truncate text-primary underline">{e.sourceUrl}</a>}
                  <p className="text-muted-foreground">Captured {relativeAge(e.capturedAt, nowMs)} · {e.contentType}</p>
                  <p className="font-mono text-[10px] text-muted-foreground">{e.contentHash.slice(0, 24)}…</p>
                  <div className="mt-1 space-y-0.5">
                    {evidenceFields(e).map((f) => (
                      <div key={f.field} className={cn("flex justify-between gap-2", conflictingFields.has(f.field) && "text-amber-300")}>
                        <span className="text-muted-foreground">{f.field}</span><span>{f.value}{conflictingFields.has(f.field) ? " ⚠" : ""}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {evidence.length === 0 && <p className="text-[11px] text-red-300">No evidence attached — approval is blocked.</p>}
            </div>
          </div>

          {/* Decision form */}
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Decision">
              <select className={inputCls} value={decision} onChange={(e) => setDecision(e.target.value as ReviewDecisionType)}>
                {(["approve", "reject", "request_changes", "archive"] as ReviewDecisionType[]).map((d) => <option key={d} value={d}>{d.replace(/_/g, " ")}</option>)}
              </select>
            </Field>
            <Field label="Final trust label (optional)">
              <select className={inputCls} value={finalTrustLabel} onChange={(e) => setFinalTrustLabel(e.target.value as PriceTrustLabel)}>
                <option value="">— keep suggested —</option>
                {Object.values(PRICE_TRUST_LABELS).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            </Field>
            <Field label="Approved availability">
              <select className={inputCls} value={availability} onChange={(e) => setAvailability(e.target.value as AvailabilityStatus)}>
                <option value="">— keep draft —</option>
                {Object.values(AVAILABILITY_STATUS_LABELS).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            </Field>
            <Field label="Approved geographic scope">
              <select className={inputCls} value={scope} onChange={(e) => setScope(e.target.value as GeographicScope)}>
                <option value="">— keep draft —</option>
                {GEOGRAPHIC_SCOPES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
              </select>
            </Field>
            <Field label="Correct price (optional)"><input className={inputCls} type="number" value={priceOverride} onChange={(e) => setPriceOverride(e.target.value)} placeholder={String(draft.price)} /></Field>
            {draft.conflictState === "conflict_detected" && (
              <label className="flex items-center gap-2 self-end text-xs"><input type="checkbox" checked={resolveConflict} onChange={(e) => setResolveConflict(e.target.checked)} /> Resolve conflict (explicit)</label>
            )}
          </div>
          <Field label="Reasoning"><textarea className={inputCls} rows={2} value={reasoning} onChange={(e) => setReasoning(e.target.value)} placeholder="Why this decision…" /></Field>

          {decision === "approve" && blockers.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /> Approval blocked: {blockers.map((b) => b.replace(/_/g, " ")).join(", ")}.
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="neon" size="sm" disabled={decision === "approve" && blockers.length > 0} onClick={() => onSubmit(input)}>
              {decision === "approve" ? <CheckCircle2 className="h-3.5 w-3.5" /> : decision === "reject" ? <XCircle className="h-3.5 w-3.5" /> : decision === "archive" ? <Archive className="h-3.5 w-3.5" /> : <PencilLine className="h-3.5 w-3.5" />}
              Submit {decision.replace(/_/g, " ")}
            </Button>
            <Button variant="glass" size="sm" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1"><span className="text-xs font-medium text-muted-foreground">{label}</span>{children}</label>;
}
