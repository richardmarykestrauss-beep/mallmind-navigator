/**
 * /admin/data-command-center — MallMind Data Command Center (Prototype).
 *
 * The operational container for MallMind's data work over the local ("Prototype —
 * local persisted data") ingestion store. This is NOT autonomous scraping: it is a
 * see-and-decide surface covering every required section — Overview, Source
 * Registry, Source Snapshots, Manual Offer Entry, CSV Staging, Staged Offers,
 * Approved Offers, Conflict/Stale Alerts, Ingestion Runs, Review Queue and
 * Decision Notes.
 *
 * Designed so future Paperclip / Perplexity / Claude research outputs can later be
 * pasted or imported as source snapshots + staged offers into these same sections
 * — no schema change required.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft, LayoutDashboard, Globe, Boxes, CheckCircle2, AlertTriangle, Clock, Camera,
  History, ClipboardCheck, StickyNote, ShieldCheck, ExternalLink, PencilLine, Upload, FileText, Database,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { loadDatabase, saveDatabase, computeOverview, decideSourceStatus, decideOfferReview } from "@/lib/ingestion/store";
import { detectConflicts, detectStaleOffers, offerHasConflict } from "@/lib/ingestion/conflicts";
import { relativeAge } from "@/lib/ingestion/freshness";
import { RISK_LEVEL_META } from "@/lib/ingestion/labels";
import { SOURCE_STATUS_META, RUN_TYPE_META, RUN_STATUS_META, sourceTypeLabel } from "@/components/ingestion/ingestionMeta";
import { TrustBadge, AvailabilityStatusBadge, FreshnessBadge, ToneBadge } from "@/components/ingestion/badges";
import { CsvSection, ManualOfferSection, SnapshotsSection, EvidenceDialog } from "@/components/ingestion/adminSections";
import { FabricPanels, FABRIC_SECTIONS } from "@/components/ingestion/fabricSections";
import { BridgePanels, BRIDGE_SECTIONS } from "@/components/ingestion/bridgeSections";
import { IntakePanels, INTAKE_SECTIONS } from "@/components/ingestion/intakeSections";
import type { IngestionDatabase, ProductOffer, SourceRegistryStatus } from "@/lib/ingestion/model";

const inputCls = "w-full rounded-lg border border-border bg-background/60 px-2 py-1 text-xs outline-none focus:border-primary/60";

/** Section anchors, in the exact order the spec requires. */
const SECTIONS: { id: string; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "registry", label: "Source Registry" },
  { id: "snapshots", label: "Source Snapshots" },
  { id: "manual", label: "Manual Offer Entry" },
  { id: "csv", label: "CSV Staging" },
  { id: "staged", label: "Staged Offers" },
  { id: "approved", label: "Approved Offers" },
  { id: "alerts", label: "Conflict/Stale Alerts" },
  { id: "runs", label: "Ingestion Runs" },
  { id: "queue", label: "Review Queue" },
  { id: "decisions", label: "Decision Notes" },
  ...FABRIC_SECTIONS.map((s) => ({ id: s.id, label: s.label })),
  ...BRIDGE_SECTIONS.map((s) => ({ id: s.id, label: s.label })),
  ...INTAKE_SECTIONS.map((s) => ({ id: s.id, label: s.label })),
];

function SectionCard({ id, icon, title, count, children }: { id: string; icon: React.ReactNode; title: string; count?: number; children: React.ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-4 border-border/70 bg-surface/40">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          {icon} {title}{count != null && <span className="text-muted-foreground">({count})</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">{children}</CardContent>
    </Card>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="px-4 py-6 text-center text-sm text-muted-foreground">{children}</p>
);

export default function DataCommandCenter() {
  const [db, setDb] = useState<IngestionDatabase>(() => loadDatabase());
  const [evidenceOffer, setEvidenceOffer] = useState<ProductOffer | null>(null);
  const nowMs = Date.now();
  const persist = (next: IngestionDatabase) => { saveDatabase(next); setDb(next); };

  const productName = (id: string) => db.products.find((p) => p.id === id)?.canonicalName ?? id;
  const retailerName = (id: string) => db.retailers.find((r) => r.id === id)?.name ?? id;
  const mallName = (id: string | null) => (id ? db.malls.find((m) => m.id === id)?.name ?? id : null);

  const conflicts = useMemo(() => detectConflicts(db), [db]);
  const stale = useMemo(() => detectStaleOffers(db, nowMs), [db, nowMs]);
  const overview = useMemo(() => computeOverview(db, nowMs), [db, nowMs]);

  const staged = db.offers.filter((o) => o.reviewStatus === "staged" || o.reviewStatus === "needs_review");
  const approved = db.offers.filter((o) => o.reviewStatus === "approved");
  const runs = [...db.runs].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const queue = db.reviewQueue.filter((q) => q.status === "staged" || q.status === "needs_review");
  const decisions = db.reviewQueue
    .filter((q) => q.reviewedAt || q.decisionNotes)
    .sort((a, b) => Date.parse(b.reviewedAt ?? b.createdAt) - Date.parse(a.reviewedAt ?? a.createdAt));

  const setSourceStatus = (id: string, status: SourceRegistryStatus) => persist(decideSourceStatus(db, id, status, new Date().toISOString()));
  const approveOffer = (id: string) => persist(decideOfferReview(db, id, "approved", "admin", "Approved from Command Center.", new Date().toISOString()));
  const offerLabel = (id: string) => {
    const o = db.offers.find((x) => x.id === id);
    return o ? `${productName(o.productId)} — ${retailerName(o.retailerId)}` : id;
  };

  return (
    <div className="mx-auto min-h-screen max-w-6xl px-4 py-6 md:px-6">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/admin/data-ingestion" className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Data Ingestion
          </Link>
          <h1 className="flex items-center gap-2 font-display text-2xl font-bold">
            <LayoutDashboard className="h-6 w-6 text-primary" /> Data Command Center
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ToneBadge tone="warning">Prototype — local persisted data</ToneBadge>
          <ToneBadge tone="muted">No autonomous scraping</ToneBadge>
        </div>
      </div>

      <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-xs text-amber-200/90">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
        <p>
          Control plane over curated demonstration data. Nothing here fetches, scrapes or auto-approves. Sources are a manual
          registry; offers are only used in answers once <b>approved</b>. Future Paperclip / Perplexity / Claude research
          outputs can be imported into these sections as source snapshots + staged offers.
        </p>
      </div>

      {/* Section nav */}
      <div className="sticky top-0 z-10 mb-5 flex flex-wrap gap-1 rounded-xl border border-border bg-surface/80 p-1 backdrop-blur">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="rounded-lg px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
            {s.label}
          </a>
        ))}
      </div>

      <div className="space-y-5">
        {/* 1 — Overview */}
        <SectionCard id="overview" icon={<Database className="h-4 w-4 text-primary" />} title="Overview">
          <div className="p-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
              <Kpi label="Sources" value={db.sources.length} />
              <Kpi label="Staged" value={staged.length} tone="warning" />
              <Kpi label="Approved" value={approved.length} tone="verified" />
              <Kpi label="Conflicts" value={conflicts.length} tone={conflicts.length ? "danger" : "muted"} />
              <Kpi label="Stale" value={stale.length} tone={stale.length ? "warning" : "muted"} />
              <Kpi label="Runs" value={db.runs.length} />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-muted-foreground">
              <span>Malls: <b className="text-foreground">{overview.totalMalls}</b></span>
              <span>Physical stores: <b className="text-foreground">{overview.totalPhysicalStores}</b></span>
              <span>Products: <b className="text-foreground">{overview.totalProducts}</b></span>
              <span>Snapshots: <b className="text-foreground">{db.snapshots.length}</b></span>
              <span>Latest run: <b className="text-foreground">{overview.latestRun ? relativeAge(overview.latestRun.startedAt, nowMs) : "—"}</b></span>
              <span>Dataset: <b className="text-foreground">{db.meta.label}</b></span>
            </div>
          </div>
        </SectionCard>

        {/* 2 — Source Registry */}
        <SectionCard id="registry" icon={<Globe className="h-4 w-4 text-primary" />} title="Source Registry" count={db.sources.length}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr className="border-b border-border/60">
                  <th className="px-4 py-2">Source / URL</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">Retailer / Mall</th>
                  <th className="px-4 py-2">Status</th><th className="px-4 py-2">Risk</th><th className="px-4 py-2">Legal / risk</th><th className="px-4 py-2">Last checked</th>
                  <th className="px-4 py-2">Owner notes</th><th className="px-4 py-2">Set status</th>
                </tr>
              </thead>
              <tbody>
                {db.sources.length === 0 && <tr><td colSpan={9}><Empty>No sources registered. Add one from Source Registry below or the ingestion workbench.</Empty></td></tr>}
                {db.sources.map((s) => (
                  <tr key={s.id} className="border-b border-border/40 align-top">
                    <td className="px-4 py-2">
                      <p className="font-medium">{s.name}</p>
                      <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex max-w-[240px] items-center gap-1 truncate text-[11px] text-primary underline">
                        <ExternalLink className="h-3 w-3 shrink-0" /> {s.sourceUrl}
                      </a>
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{sourceTypeLabel(s.sourceType)}</td>
                    <td className="px-4 py-2 text-xs">
                      {s.retailerId ? retailerName(s.retailerId) : "—"}
                      {mallName(s.mallId) && <span className="block text-[11px] text-muted-foreground">{mallName(s.mallId)}</span>}
                    </td>
                    <td className="px-4 py-2"><ToneBadge tone={SOURCE_STATUS_META[s.status].tone} title={SOURCE_STATUS_META[s.status].description}>{SOURCE_STATUS_META[s.status].label}</ToneBadge></td>
                    <td className="px-4 py-2"><ToneBadge tone={RISK_LEVEL_META[s.riskLevel].tone} title={RISK_LEVEL_META[s.riskLevel].description}>{RISK_LEVEL_META[s.riskLevel].label}</ToneBadge></td>
                    <td className="px-4 py-2 max-w-[200px] text-[11px] text-muted-foreground">{s.legalRiskNote ?? "—"}</td>
                    <td className="px-4 py-2 text-[11px] text-muted-foreground">{s.lastCheckedAt ? relativeAge(s.lastCheckedAt, nowMs) : "—"}</td>
                    <td className="px-4 py-2 max-w-[180px] text-[11px] text-muted-foreground">{s.ownerNotes ?? "—"}</td>
                    <td className="px-4 py-2">
                      <select className={cn(inputCls, "w-32")} value={s.status} onChange={(e) => setSourceStatus(s.id, e.target.value as SourceRegistryStatus)}>
                        {(Object.keys(SOURCE_STATUS_META) as SourceRegistryStatus[]).map((st) => <option key={st} value={st}>{SOURCE_STATUS_META[st].label}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        {/* 3 — Source Snapshots */}
        <SectionCard id="snapshots" icon={<Camera className="h-4 w-4 text-primary" />} title="Source Snapshots" count={db.snapshots.length}>
          <div className="p-4"><SnapshotsSection db={db} persist={persist} nowMs={nowMs} retailerName={retailerName} /></div>
        </SectionCard>

        {/* 4 — Manual Offer Entry */}
        <SectionCard id="manual" icon={<PencilLine className="h-4 w-4 text-primary" />} title="Manual Offer Entry">
          <div className="p-4"><ManualOfferSection db={db} persist={persist} /></div>
        </SectionCard>

        {/* 5 — CSV Staging */}
        <SectionCard id="csv" icon={<Upload className="h-4 w-4 text-primary" />} title="CSV Staging">
          <div className="p-4"><CsvSection db={db} persist={persist} /></div>
        </SectionCard>

        {/* 6 — Staged Offers */}
        <SectionCard id="staged" icon={<Boxes className="h-4 w-4 text-amber-300" />} title="Staged Offers" count={staged.length}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr className="border-b border-border/60">
                  <th className="px-4 py-2">Product / Retailer</th><th className="px-4 py-2">Price</th><th className="px-4 py-2">Trust</th>
                  <th className="px-4 py-2">Availability</th><th className="px-4 py-2">Freshness</th><th className="px-4 py-2">Flags</th><th className="px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {staged.length === 0 && <tr><td colSpan={7}><Empty>Nothing staged — all offers reviewed.</Empty></td></tr>}
                {staged.map((o) => (
                  <tr key={o.id} className="border-b border-border/40">
                    <td className="px-4 py-2">{productName(o.productId)}<span className="block text-[11px] text-muted-foreground">{retailerName(o.retailerId)}</span></td>
                    <td className="px-4 py-2 font-semibold">R{o.currentPrice.toLocaleString("en-ZA")}</td>
                    <td className="px-4 py-2"><TrustBadge label={o.priceTrustLabel} /></td>
                    <td className="px-4 py-2"><AvailabilityStatusBadge status={o.availabilityStatus} /></td>
                    <td className="px-4 py-2"><FreshnessBadge offer={o} nowMs={nowMs} /></td>
                    <td className="px-4 py-2">{offerHasConflict(o.id, conflicts) ? <ToneBadge tone="danger">Conflict</ToneBadge> : <span className="text-[11px] text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-2">
                      <div className="flex gap-1.5">
                        <Button variant="neon" size="sm" onClick={() => approveOffer(o.id)}><CheckCircle2 className="h-3.5 w-3.5" /> Approve</Button>
                        <Button variant="glass" size="sm" onClick={() => setEvidenceOffer(o)}><FileText className="h-3.5 w-3.5" /> Evidence</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        {/* 7 — Approved Offers */}
        <SectionCard id="approved" icon={<CheckCircle2 className="h-4 w-4 text-secondary" />} title="Approved Offers" count={approved.length}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr className="border-b border-border/60">
                  <th className="px-4 py-2">Product / Retailer</th><th className="px-4 py-2">Price</th><th className="px-4 py-2">Trust</th>
                  <th className="px-4 py-2">Availability</th><th className="px-4 py-2">Freshness</th><th className="px-4 py-2">Source</th><th className="px-4 py-2">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {approved.length === 0 && <tr><td colSpan={7}><Empty>No approved offers yet.</Empty></td></tr>}
                {approved.map((o) => (
                  <tr key={o.id} className="border-b border-border/40">
                    <td className="px-4 py-2">{productName(o.productId)}<span className="block text-[11px] text-muted-foreground">{retailerName(o.retailerId)}</span></td>
                    <td className="px-4 py-2 font-semibold">R{o.currentPrice.toLocaleString("en-ZA")}</td>
                    <td className="px-4 py-2"><TrustBadge label={o.priceTrustLabel} /></td>
                    <td className="px-4 py-2"><AvailabilityStatusBadge status={o.availabilityStatus} /></td>
                    <td className="px-4 py-2"><FreshnessBadge offer={o} nowMs={nowMs} /></td>
                    <td className="px-4 py-2 text-[11px] text-muted-foreground">{sourceTypeLabel(o.sourceType)}</td>
                    <td className="px-4 py-2"><Button variant="glass" size="sm" onClick={() => setEvidenceOffer(o)}><FileText className="h-3.5 w-3.5" /> View</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        {/* 8 — Conflict / Stale Alerts */}
        <SectionCard id="alerts" icon={<AlertTriangle className="h-4 w-4 text-red-300" />} title="Conflict/Stale Alerts" count={conflicts.length + stale.length}>
          <div className="space-y-4 p-4">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Price conflicts ({conflicts.length})</p>
              {conflicts.length === 0 && <p className="text-sm text-muted-foreground">No conflicting prices within any single source category.</p>}
              <div className="space-y-2">
                {conflicts.map((c) => (
                  <div key={c.id} className="rounded-lg border border-border/60 bg-surface/30 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{c.productName} <span className="text-xs text-muted-foreground">· {c.sourceCategory.replace(/_/g, " ")}</span></p>
                      <ToneBadge tone={c.severity === "error" ? "danger" : "warning"}>{c.severity} · {c.spreadPct}% spread</ToneBadge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {c.prices.map((p) => `R${p.toLocaleString("en-ZA")}`).join(" vs ")} — spread R{c.spread.toLocaleString("en-ZA")} across {c.offerIds.length} offers. Needs human review; not auto-resolved.
                    </p>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Clock className="h-3.5 w-3.5" /> Stale / expired ({stale.length})</p>
              {stale.length === 0 && <p className="text-sm text-muted-foreground">No stale or expired offers.</p>}
              <div className="flex flex-wrap gap-2">
                {stale.map((s) => (
                  <ToneBadge key={s.offerId} tone={s.state === "expired" ? "danger" : "warning"} title={`${Math.round(s.ageHours)}h old`}>
                    {s.productName} · {s.retailerName} · {s.state}
                  </ToneBadge>
                ))}
              </div>
            </div>
          </div>
        </SectionCard>

        {/* 9 — Ingestion Runs */}
        <SectionCard id="runs" icon={<History className="h-4 w-4 text-primary" />} title="Ingestion Runs" count={db.runs.length}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr className="border-b border-border/60">
                  <th className="px-4 py-2">Run type</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Found</th>
                  <th className="px-4 py-2">Staged</th><th className="px-4 py-2">Rejected</th><th className="px-4 py-2">Conflicts</th><th className="px-4 py-2">Stale</th><th className="px-4 py-2">Created</th><th className="px-4 py-2">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {runs.length === 0 && <tr><td colSpan={9}><Empty>No ingestion runs recorded.</Empty></td></tr>}
                {runs.map((r) => {
                  const rt = RUN_TYPE_META[r.runType]; const rs = RUN_STATUS_META[r.status];
                  const evidence = r.evidenceUrl ?? null;
                  return (
                    <tr key={r.id} className="border-b border-border/40">
                      <td className="px-4 py-2"><ToneBadge tone={rt.tone}>{rt.label}</ToneBadge></td>
                      <td className="px-4 py-2"><ToneBadge tone={rs.tone}>{rs.label}</ToneBadge></td>
                      <td className="px-4 py-2">{r.totalRows}</td>
                      <td className="px-4 py-2">{r.acceptedRows + r.warningRows}</td>
                      <td className="px-4 py-2">{r.rejectedRows}</td>
                      <td className="px-4 py-2">{r.conflictsDetected > 0 ? <ToneBadge tone="danger">{r.conflictsDetected}</ToneBadge> : "0"}</td>
                      <td className="px-4 py-2">{r.staleItemsDetected > 0 ? <ToneBadge tone="warning">{r.staleItemsDetected}</ToneBadge> : "0"}</td>
                      <td className="px-4 py-2 text-[11px] text-muted-foreground">{relativeAge(r.startedAt, nowMs)}</td>
                      <td className="px-4 py-2 text-xs">
                        {evidence
                          ? <a href={evidence} target="_blank" rel="noreferrer" className="inline-flex max-w-[200px] items-center gap-1 truncate text-primary underline"><ExternalLink className="h-3 w-3 shrink-0" /> {r.filename ?? evidence}</a>
                          : <span className="text-muted-foreground">{r.filename ?? "—"}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-[11px] text-muted-foreground">Approvals happen per-offer in the Review Queue — runs record what was found/staged, never a fake auto-approval count.</p>
        </SectionCard>

        {/* 10 — Review Queue */}
        <SectionCard id="queue" icon={<ClipboardCheck className="h-4 w-4 text-amber-300" />} title="Review Queue" count={queue.length}>
          <div className="divide-y divide-border/40">
            {queue.length === 0 && <Empty>Review queue is clear.</Empty>}
            {queue.map((q) => {
              const offer = q.entityType === "product_offer" ? db.offers.find((o) => o.id === q.entityId) : undefined;
              return (
                <div key={q.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{q.entityType === "product_offer" ? offerLabel(q.entityId) : q.entityType}</p>
                    <p className="text-[11px] text-muted-foreground">{q.reason}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <ToneBadge tone={q.severity === "error" ? "danger" : q.severity === "warning" ? "warning" : "muted"}>{q.severity}</ToneBadge>
                    <ToneBadge tone="warning">{q.status.replace(/_/g, " ")}</ToneBadge>
                    {offer && <Button variant="neon" size="sm" onClick={() => approveOffer(offer.id)}><CheckCircle2 className="h-3.5 w-3.5" /> Approve</Button>}
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>

        {/* 11 — Decision Notes */}
        <SectionCard id="decisions" icon={<StickyNote className="h-4 w-4 text-primary" />} title="Decision Notes" count={decisions.length}>
          <div className="divide-y divide-border/40">
            {decisions.length === 0 && <Empty>No decisions recorded yet.</Empty>}
            {decisions.map((q) => (
              <div key={q.id} className="px-4 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">{q.entityType === "product_offer" ? offerLabel(q.entityId) : q.entityType}</p>
                  <ToneBadge tone={q.status === "approved" ? "verified" : q.status === "rejected" ? "danger" : "muted"}>{q.status.replace(/_/g, " ")}</ToneBadge>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {q.decisionNotes ?? q.reason}
                  {q.reviewedBy && <> — by {q.reviewedBy}{q.reviewedAt ? `, ${relativeAge(q.reviewedAt, nowMs)}` : ""}</>}
                </p>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* Retail Intelligence Fabric — Sprint 1 operational views */}
        <div className="mt-2 border-t border-border/50 pt-4">
          <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold"><LayoutDashboard className="h-5 w-5 text-primary" /> Retail Intelligence Fabric</h2>
          <div className="space-y-5">
            <FabricPanels resolveOfferLabel={offerLabel} nowMs={nowMs} />
          </div>
        </div>

        {/* Sprint 2A — Evidence → Offer review bridge */}
        <div className="mt-2 border-t border-border/50 pt-4">
          <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold"><LayoutDashboard className="h-5 w-5 text-primary" /> Evidence → Offer Bridge</h2>
          <div className="space-y-5">
            <BridgePanels resolveProductName={productName} nowMs={nowMs} />
          </div>
        </div>

        {/* Sprint 2C — Bulk Intake Engine */}
        <div className="mt-2 border-t border-border/50 pt-4">
          <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold"><LayoutDashboard className="h-5 w-5 text-primary" /> Bulk Intake Engine</h2>
          <div className="space-y-5">
            <IntakePanels />
          </div>
        </div>
      </div>

      <p className="mt-6 text-center text-[11px] text-muted-foreground">
        MallMind Data Command Center · Prototype — local persisted data · No automated scraping, no paid APIs, no live-verified claims without evidence.
      </p>

      <EvidenceDialog db={db} offer={evidenceOffer} onClose={() => setEvidenceOffer(null)} nowMs={nowMs} productName={productName} retailerName={retailerName} />
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "warning" | "verified" | "danger" | "muted" }) {
  const toneCls = tone === "warning" ? "text-amber-300" : tone === "verified" ? "text-secondary" : tone === "danger" ? "text-red-300" : "text-foreground";
  return (
    <Card className="border-border/70 bg-surface/50">
      <CardContent className="p-3 text-center">
        <p className={cn("text-2xl font-bold leading-none", toneCls)}>{value}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}
