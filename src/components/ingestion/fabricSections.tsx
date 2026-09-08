/**
 * Retail Intelligence Fabric — Data Command Center operational views.
 *
 * Self-contained panels appended to the existing Data Command Center: Adapter
 * Registry, Source Policies, Evidence Vault, Adapter Runs, plus a Provenance
 * detail drawer. Prototype fixtures only — no live source request is performed.
 */

import { useMemo, useState } from "react";
import {
  Plug, ShieldAlert, FileStack, Activity, ExternalLink, Play, PowerOff, Power, Layers,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ToneBadge } from "@/components/ingestion/badges";
import type { BadgeTone } from "@/lib/ingestion/labels";
import { RISK_LEVEL_META } from "@/lib/ingestion/labels";
import { relativeAge } from "@/lib/ingestion/freshness";
import {
  loadFabric, saveFabric, resetFabricSeed, buildRegistry, executeAndPersist, DEMO_MANUAL_PAYLOAD,
} from "@/lib/fabric/store";
import type {
  FabricDatabase, EvidenceRecord, AdapterLifecycleState, AutomationStatus, ProvenanceLink,
} from "@/lib/fabric/types";

const LIFECYCLE_TONE: Record<AdapterLifecycleState, BadgeTone> = {
  discovered: "muted", captured: "info", extracted: "info", normalized: "info",
  validated: "fresh", conflict_checked: "fresh", reviewed: "special", approved: "verified",
  published: "verified", stale: "warning", withdrawn: "muted", failed: "danger",
};

const AUTOMATION_TONE: Record<AutomationStatus, BadgeTone> = {
  manual_only: "warning", approved_public_observation: "info", authorized_feed: "fresh", authorized_api: "verified", blocked: "danger",
};
const AUTOMATION_LABEL: Record<AutomationStatus, string> = {
  manual_only: "Manual only", approved_public_observation: "Approved public observation", authorized_feed: "Authorized feed", authorized_api: "Authorized API", blocked: "Blocked",
};

function SectionCard({ id, icon, title, count, children }: { id: string; icon: React.ReactNode; title: string; count?: number; children: React.ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-4 border-border/70 bg-surface/40">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">{icon} {title}{count != null && <span className="text-muted-foreground">({count})</span>}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">{children}</CardContent>
    </Card>
  );
}
const Empty = ({ children }: { children: React.ReactNode }) => <p className="px-4 py-6 text-center text-sm text-muted-foreground">{children}</p>;

/** Section descriptors so the Data Command Center can add nav anchors. */
export const FABRIC_SECTIONS = [
  { id: "adapters", label: "Adapter Registry" },
  { id: "policies", label: "Source Policies" },
  { id: "evidence", label: "Evidence Vault" },
  { id: "adapter-runs", label: "Adapter Runs" },
] as const;

export function FabricPanels({ resolveOfferLabel, nowMs }: { resolveOfferLabel: (offerId: string) => string; nowMs: number }) {
  const [fabric, setFabric] = useState<FabricDatabase>(() => loadFabric());
  const [evidenceDetail, setEvidenceDetail] = useState<EvidenceRecord | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const registry = useMemo(() => buildRegistry(), []);
  const persist = (next: FabricDatabase) => { saveFabric(next); setFabric(next); };

  const policyFor = (sourceId: string) => fabric.policies.find((p) => p.sourceId === sourceId);
  const linksForEvidence = (evidenceId: string) => fabric.provenance.filter((l) => l.evidenceId === evidenceId);

  const run = async (adapterId: string) => {
    const reg = registry.get(adapterId);
    const input = adapterId === "manual_snapshot" ? DEMO_MANUAL_PAYLOAD : undefined;
    const { db: next, run } = await executeAndPersist(fabric, registry, adapterId, new Date().toISOString(), input);
    persist(next);
    setMsg(`${reg?.name}: run ${run.id.slice(0, 14)} → ${run.status.replace(/_/g, " ")}${run.policyDecision && !run.policyDecision.allowed ? ` (${run.policyDecision.reason})` : ` · ${run.captures} captured, ${run.evidenceIds.length} evidence`}. No offer was published.`);
  };
  const toggle = (adapterId: string, enabled: boolean) => { registry.setEnabled(adapterId, enabled); setMsg(`${adapterId} ${enabled ? "enabled" : "disabled"}.`); setFabric({ ...fabric }); };

  return (
    <>
      <div className="flex items-center justify-between gap-2 px-1">
        <p className="text-[11px] text-muted-foreground">Retail Intelligence Fabric — prototype fixtures. No live source request is performed.</p>
        <Button variant="glass" size="sm" onClick={() => { const f = resetFabricSeed(nowMs); setFabric(f); setMsg("Fabric seed reset."); }}>Reset fabric seed</Button>
      </div>
      {msg && <div className="mx-1 rounded-lg border border-secondary/40 bg-secondary/10 px-3 py-2 text-xs text-secondary">{msg}</div>}

      {/* A — Adapter Registry */}
      <SectionCard id="adapters" icon={<Plug className="h-4 w-4 text-primary" />} title="Adapter Registry" count={registry.list().length}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border/60">
                <th className="px-4 py-2">Adapter</th><th className="px-4 py-2">Mode</th><th className="px-4 py-2">Ver</th><th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Source / Policy</th><th className="px-4 py-2">Capabilities</th><th className="px-4 py-2">Last run</th><th className="px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {registry.list().map((r) => {
                const pol = policyFor(r.adapter.sourceId);
                const caps = Object.entries(r.capabilities).filter(([, v]) => v).map(([k]) => k.replace(/^supports/, "").replace(/([A-Z])/g, " $1").trim().toLowerCase());
                return (
                  <tr key={r.adapter.adapterId} className="border-b border-border/40 align-top">
                    <td className="px-4 py-2"><p className="font-medium">{r.name}</p><p className="text-[11px] text-muted-foreground">{r.adapter.adapterId}</p></td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{r.adapter.mode.replace(/_/g, " ")}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{r.adapter.version}</td>
                    <td className="px-4 py-2"><ToneBadge tone={r.status === "approved" ? "verified" : r.status === "disabled" ? "danger" : r.status === "manual" ? "warning" : "info"}>{r.status}</ToneBadge></td>
                    <td className="px-4 py-2 text-xs">{r.adapter.sourceId}<span className="block">{pol ? <ToneBadge tone={AUTOMATION_TONE[pol.automationStatus]}>{AUTOMATION_LABEL[pol.automationStatus]}</ToneBadge> : <ToneBadge tone="danger">no policy</ToneBadge>}</span></td>
                    <td className="px-4 py-2 max-w-[220px] text-[10px] text-muted-foreground">{caps.join(", ")}</td>
                    <td className="px-4 py-2 text-[11px] text-muted-foreground">{r.lastRunAt ? relativeAge(r.lastRunAt, nowMs) : "—"}</td>
                    <td className="px-4 py-2">
                      <div className="flex gap-1.5">
                        <Button variant="neon" size="sm" disabled={!r.enabled} onClick={() => run(r.adapter.adapterId)}><Play className="h-3.5 w-3.5" /> Run</Button>
                        <Button variant="glass" size="sm" onClick={() => toggle(r.adapter.adapterId, !r.enabled)}>{r.enabled ? <><PowerOff className="h-3.5 w-3.5" /> Disable</> : <><Power className="h-3.5 w-3.5" /> Enable</>}</Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-2 text-[11px] text-muted-foreground">Running an adapter walks it through the lifecycle and stages evidence for review. No adapter can publish an offer directly.</p>
      </SectionCard>

      {/* B — Source Policies */}
      <SectionCard id="policies" icon={<ShieldAlert className="h-4 w-4 text-amber-300" />} title="Source Policies" count={fabric.policies.length}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border/60">
                <th className="px-4 py-2">Source</th><th className="px-4 py-2">Automation</th><th className="px-4 py-2">Allowed modes</th><th className="px-4 py-2">Legal risk</th>
                <th className="px-4 py-2">Review</th><th className="px-4 py-2">Robots / Terms</th><th className="px-4 py-2">Owner notes</th>
              </tr>
            </thead>
            <tbody>
              {fabric.policies.map((p) => (
                <tr key={p.sourceId} className="border-b border-border/40 align-top">
                  <td className="px-4 py-2 font-medium">{p.sourceId}</td>
                  <td className="px-4 py-2"><ToneBadge tone={AUTOMATION_TONE[p.automationStatus]}>{AUTOMATION_LABEL[p.automationStatus]}</ToneBadge></td>
                  <td className="px-4 py-2 max-w-[220px] text-[11px] text-muted-foreground">{p.allowedModes.map((m) => m.replace(/_/g, " ")).join(", ") || "— none —"}</td>
                  <td className="px-4 py-2"><ToneBadge tone={RISK_LEVEL_META[p.legalRisk].tone}>{RISK_LEVEL_META[p.legalRisk].label}</ToneBadge></td>
                  <td className="px-4 py-2 text-xs">{p.requiresHumanReview ? "Required" : "—"}</td>
                  <td className="px-4 py-2 text-xs">
                    {p.robotsUrl ? <a href={p.robotsUrl} target="_blank" rel="noreferrer" className="block text-primary underline">robots</a> : null}
                    {p.termsUrl ? <a href={p.termsUrl} target="_blank" rel="noreferrer" className="block text-primary underline">terms</a> : null}
                    {!p.robotsUrl && !p.termsUrl ? "—" : null}
                  </td>
                  <td className="px-4 py-2 max-w-[200px] text-[11px] text-muted-foreground">{p.ownerNotes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* C — Evidence Vault */}
      <SectionCard id="evidence" icon={<FileStack className="h-4 w-4 text-primary" />} title="Evidence Vault" count={fabric.evidence.length}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border/60">
                <th className="px-4 py-2">Evidence</th><th className="px-4 py-2">Source</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">Captured</th>
                <th className="px-4 py-2">Adapter</th><th className="px-4 py-2">Lifecycle</th><th className="px-4 py-2">Hash</th><th className="px-4 py-2">Offers</th><th className="px-4 py-2">Review</th><th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {fabric.evidence.length === 0 && <tr><td colSpan={10}><Empty>No evidence captured yet.</Empty></td></tr>}
              {fabric.evidence.map((e) => {
                const offerLinks = linksForEvidence(e.id).filter((l) => l.entityType === "product_offer");
                return (
                  <tr key={e.id} className="border-b border-border/40 align-top">
                    <td className="px-4 py-2 text-[11px]">{e.id.slice(0, 16)}{e.revision > 1 && <ToneBadge tone="muted">rev {e.revision}</ToneBadge>}</td>
                    <td className="px-4 py-2 text-xs">{e.sourceOwner ?? e.sourceId}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{e.contentType}</td>
                    <td className="px-4 py-2 text-[11px] text-muted-foreground">{relativeAge(e.capturedAt, nowMs)}</td>
                    <td className="px-4 py-2 text-[11px] text-muted-foreground">{e.adapterId} v{e.adapterVersion}</td>
                    <td className="px-4 py-2"><ToneBadge tone={LIFECYCLE_TONE[e.lifecycleState]}>{e.lifecycleState.replace(/_/g, " ")}</ToneBadge></td>
                    <td className="px-4 py-2 font-mono text-[10px] text-muted-foreground">{e.contentHash.slice(0, 22)}…</td>
                    <td className="px-4 py-2 text-xs">{offerLinks.length > 0 ? offerLinks.map((l) => <span key={l.id} className="block text-[11px] text-muted-foreground" title={l.relation}>{resolveOfferLabel(l.entityId)}</span>) : "—"}</td>
                    <td className="px-4 py-2"><ToneBadge tone={e.reviewerStatus === "accepted" ? "verified" : e.reviewerStatus === "rejected" ? "danger" : e.reviewerStatus === "superseded" ? "muted" : "warning"}>{e.reviewerStatus}</ToneBadge></td>
                    <td className="px-4 py-2"><Button variant="glass" size="sm" onClick={() => setEvidenceDetail(e)}><Layers className="h-3.5 w-3.5" /> Details</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* D — Adapter Runs */}
      <SectionCard id="adapter-runs" icon={<Activity className="h-4 w-4 text-primary" />} title="Adapter Runs" count={fabric.runs.length}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border/60">
                <th className="px-4 py-2">Run</th><th className="px-4 py-2">Adapter</th><th className="px-4 py-2">Source</th><th className="px-4 py-2">Stage</th>
                <th className="px-4 py-2">Disc.</th><th className="px-4 py-2">Cap.</th><th className="px-4 py-2">Extr.</th><th className="px-4 py-2">Val.fail</th><th className="px-4 py-2">Warn</th><th className="px-4 py-2">Evidence</th><th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {fabric.runs.length === 0 && <tr><td colSpan={11}><Empty>No adapter runs yet — run an adapter above.</Empty></td></tr>}
              {[...fabric.runs].reverse().map((r) => (
                <tr key={r.id} className="border-b border-border/40">
                  <td className="px-4 py-2 text-[11px]">{r.id.slice(0, 14)}</td>
                  <td className="px-4 py-2 text-xs">{r.adapterId}</td>
                  <td className="px-4 py-2 text-xs">{r.sourceId}</td>
                  <td className="px-4 py-2"><ToneBadge tone={LIFECYCLE_TONE[r.lifecycleStage]}>{r.lifecycleStage.replace(/_/g, " ")}</ToneBadge></td>
                  <td className="px-4 py-2">{r.candidatesDiscovered}</td>
                  <td className="px-4 py-2">{r.captures}</td>
                  <td className="px-4 py-2">{r.extractedCandidates}</td>
                  <td className="px-4 py-2">{r.validationFailures > 0 ? <ToneBadge tone="danger">{r.validationFailures}</ToneBadge> : "0"}</td>
                  <td className="px-4 py-2">{r.warnings}</td>
                  <td className="px-4 py-2">{r.evidenceIds.length}</td>
                  <td className="px-4 py-2">
                    <ToneBadge tone={r.status === "blocked" ? "danger" : r.status === "needs_review" ? "warning" : r.status === "failed" ? "danger" : "verified"}>{r.status.replace(/_/g, " ")}</ToneBadge>
                    {r.status === "blocked" && r.policyDecision && <span className="block text-[10px] text-red-300">{r.policyDecision.reason}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <ProvenanceDrawer evidence={evidenceDetail} links={evidenceDetail ? linksForEvidence(evidenceDetail.id) : []} resolveOfferLabel={resolveOfferLabel} nowMs={nowMs} onClose={() => setEvidenceDetail(null)} />
    </>
  );
}

// E — Provenance detail drawer
function ProvenanceDrawer({ evidence, links, resolveOfferLabel, nowMs, onClose }: {
  evidence: EvidenceRecord | null; links: ProvenanceLink[]; resolveOfferLabel: (id: string) => string; nowMs: number; onClose: () => void;
}) {
  const e = evidence;
  const fields = (e?.structuredData?.fields as { field: string; value: unknown; confidence: number; evidenceText?: string }[] | undefined) ?? null;
  return (
    <Dialog open={!!e} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Layers className="h-4 w-4 text-primary" /> Provenance detail</DialogTitle></DialogHeader>
        {e && (
          <div className="space-y-3 text-sm">
            <div className="rounded-lg border border-border/60 bg-surface/40 p-3">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>Source: <b className="text-foreground">{e.sourceOwner ?? e.sourceId}</b></span>
                <span>Captured: {relativeAge(e.capturedAt, nowMs)}</span>
                <span>Adapter: {e.adapterId} v{e.adapterVersion}</span>
                <span>Extractor: {e.extractorId ?? "—"} {e.extractorVersion ? `v${e.extractorVersion}` : ""}</span>
                <span>Lifecycle: {e.lifecycleState.replace(/_/g, " ")}</span>
                <span>Content type: {e.contentType}</span>
                {e.pageNumber != null && <span>Page: {e.pageNumber}</span>}
                {e.boundingBox && <span>Crop: {e.boundingBox.x},{e.boundingBox.y} {e.boundingBox.width}×{e.boundingBox.height}</span>}
              </div>
              {e.sourceUrl && <a href={e.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 break-all text-xs text-primary underline"><ExternalLink className="h-3 w-3 shrink-0" /> {e.sourceUrl}</a>}
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">{e.contentHash}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">Prototype fixture — no live source request performed. Raw content ref: {e.rawContentRef ?? e.documentRef ?? "—"}</p>
            </div>

            {e.extractedText && <p className="rounded border border-border/50 bg-background/40 px-2 py-1 text-xs text-muted-foreground">“{e.extractedText}”</p>}

            {e.fieldConfidence && (
              <div>
                <p className="mb-1 text-xs font-semibold text-muted-foreground">Field confidence</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {Object.entries(e.fieldConfidence).map(([k, v]) => (
                    <div key={k} className="flex items-center gap-2 text-[11px]">
                      <span className="w-40 text-muted-foreground">{k.replace(/Confidence|Authority/, "").replace(/([A-Z])/g, " $1").trim()}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${Math.round(v * 100)}%` }} /></div>
                      <span className="w-8 text-right text-muted-foreground">{Math.round(v * 100)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {fields && (
              <div>
                <p className="mb-1 text-xs font-semibold text-muted-foreground">Extracted fields</p>
                <div className="space-y-1">
                  {fields.map((f, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 rounded border border-border/40 px-2 py-1 text-[11px]">
                      <span className="text-muted-foreground">{f.field}</span>
                      <span className="text-foreground">{String(f.value)}</span>
                      <ToneBadge tone={f.confidence >= 0.8 ? "verified" : f.confidence >= 0.5 ? "info" : "warning"}>{Math.round(f.confidence * 100)}%</ToneBadge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <p className="mb-1 text-xs font-semibold text-muted-foreground">Provenance links ({links.length})</p>
              {links.length === 0 && <p className="text-[11px] text-muted-foreground">No linked entities.</p>}
              {links.map((l) => (
                <p key={l.id} className="text-[11px] text-muted-foreground">{l.entityType.replace(/_/g, " ")}: <b className="text-foreground">{l.entityType === "product_offer" ? resolveOfferLabel(l.entityId) : l.entityId}</b> — {l.relation.replace(/_/g, " ")}</p>
              ))}
            </div>

            {e.reviewerNotes && <p className="text-[11px] text-muted-foreground">Reviewer notes: {e.reviewerNotes}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
