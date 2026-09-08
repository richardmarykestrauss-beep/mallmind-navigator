/**
 * /admin/data-ingestion — MallMind Data Ingestion workbench (Prototype).
 *
 * A working admin surface over the local ("Prototype — local persisted data")
 * ingestion store: overview, source registry, source snapshots, CSV import with
 * preview/staging, manual offer entry with publish gating, a review queue, an
 * evidence panel, and an assistant preview. Curated demonstration data only — no
 * live scraping, no fake integrations, no dead buttons. The full operational
 * hub lives at /admin/data-command-center.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Database, Store as StoreIcon, Package, Tag, AlertTriangle, Clock,
  ShieldCheck, FileText, Sparkles, RotateCcw, ArrowLeft, CheckCircle2, XCircle, PencilLine, Globe, LayoutDashboard,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  loadDatabase, saveDatabase, resetToSeed, computeOverview, decideOfferReview,
  addSource, decideSourceStatus, type SourceInput,
} from "@/lib/ingestion/store";
import { buildShopperAnswer, type ShopperOption, type RecommendationMode } from "@/lib/fabric/recommendationSpine";
import { loadFabric } from "@/lib/fabric/store";
import { RISK_LEVEL_META } from "@/lib/ingestion/labels";
import { relativeAge } from "@/lib/ingestion/freshness";
import { isValidHttpUrl } from "@/lib/ingestion/validation";
import { SOURCE_TYPE_OPTIONS, SOURCE_STATUS_META, sourceTypeLabel } from "@/components/ingestion/ingestionMeta";
import { CsvSection, ManualOfferSection, SnapshotsSection, EvidenceDialog, inputCls } from "@/components/ingestion/adminSections";
import type { IngestionDatabase, ProductOffer, SourceType, SourceRegistryStatus, RiskLevel } from "@/lib/ingestion/model";
import { TrustBadge, AvailabilityBadge, FreshnessBadge, PublishedBadge, ToneBadge } from "@/components/ingestion/badges";

const TABS = ["overview", "sources", "snapshots", "csv", "manual", "review", "assistant"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { overview: "Overview", sources: "Sources", snapshots: "Snapshots", csv: "CSV import", manual: "Manual offer", review: "Review queue", assistant: "Assistant preview" };

export default function DataIngestion() {
  const [db, setDb] = useState<IngestionDatabase>(() => loadDatabase());
  const [tab, setTab] = useState<Tab>("overview");
  const [evidenceOffer, setEvidenceOffer] = useState<ProductOffer | null>(null);
  const nowMs = Date.now();

  const persist = (next: IngestionDatabase) => { saveDatabase(next); setDb(next); };
  const productName = (id: string) => db.products.find((p) => p.id === id)?.canonicalName ?? id;
  const retailerName = (id: string) => db.retailers.find((r) => r.id === id)?.name ?? id;
  const overview = useMemo(() => computeOverview(db, nowMs), [db, nowMs]);

  return (
    <div className="mx-auto min-h-screen max-w-6xl px-4 py-6 md:px-6">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/admin" className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Admin
          </Link>
          <h1 className="flex items-center gap-2 font-display text-2xl font-bold">
            <Database className="h-6 w-6 text-primary" /> Data Ingestion
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ToneBadge tone="warning">Prototype — local persisted data</ToneBadge>
          <ToneBadge tone="muted">Curated demonstration data</ToneBadge>
          <Link to="/admin/data-command-center">
            <Button variant="glass" size="sm"><LayoutDashboard className="h-3.5 w-3.5" /> Command Center</Button>
          </Link>
          <Button variant="glass" size="sm" onClick={() => persist(resetToSeed(nowMs))}>
            <RotateCcw className="h-3.5 w-3.5" /> Reset seed
          </Button>
        </div>
      </div>

      {/* Honest banner */}
      <div className="mb-5 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-xs text-amber-200/90">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
        <p>
          This is a working <b>prototype</b> over locally-persisted, <b>curated demonstration</b> data — not live retailer data.
          No live scraping or automated verification is performed. Branch stock is only marked confirmed when branch-specific evidence exists.
        </p>
      </div>

      {/* Tab bar */}
      <div className="mb-5 flex flex-wrap gap-1 rounded-xl border border-border bg-surface/40 p-1">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={cn("rounded-lg px-3 py-1.5 text-sm font-medium transition-all",
              tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewSection db={db} overview={overview} nowMs={nowMs} productName={productName} retailerName={retailerName} onEvidence={setEvidenceOffer} />}
      {tab === "sources" && <SourcesSection db={db} persist={persist} nowMs={nowMs} retailerName={retailerName} />}
      {tab === "snapshots" && <SnapshotsSection db={db} persist={persist} nowMs={nowMs} retailerName={retailerName} />}
      {tab === "csv" && <CsvSection db={db} persist={persist} />}
      {tab === "manual" && <ManualOfferSection db={db} persist={persist} onDone={() => setTab("review")} />}
      {tab === "review" && <ReviewSection db={db} persist={persist} nowMs={nowMs} productName={productName} retailerName={retailerName} onEvidence={setEvidenceOffer} />}
      {tab === "assistant" && <AssistantSection db={db} nowMs={nowMs} />}

      <EvidenceDialog db={db} offer={evidenceOffer} onClose={() => setEvidenceOffer(null)} nowMs={nowMs} productName={productName} retailerName={retailerName} />
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────────
function Stat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number | string; tone?: string }) {
  return (
    <Card className="border-border/70 bg-surface/50">
      <CardContent className="flex items-center gap-3 p-4">
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", tone ?? "bg-primary/12 text-primary")}>{icon}</div>
        <div><p className="text-xl font-bold leading-none">{value}</p><p className="mt-1 text-[11px] text-muted-foreground">{label}</p></div>
      </CardContent>
    </Card>
  );
}

function OverviewSection({ db, overview, nowMs, productName, retailerName, onEvidence }: {
  db: IngestionDatabase; overview: ReturnType<typeof computeOverview>; nowMs: number;
  productName: (id: string) => string; retailerName: (id: string) => string; onEvidence: (o: ProductOffer) => void;
}) {
  const recent = [...db.offers].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 8);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat icon={<StoreIcon className="h-5 w-5" />} label="Malls" value={overview.totalMalls} />
        <Stat icon={<StoreIcon className="h-5 w-5" />} label="Physical stores" value={overview.totalPhysicalStores} />
        <Stat icon={<Package className="h-5 w-5" />} label="Products" value={overview.totalProducts} />
        <Stat icon={<Tag className="h-5 w-5" />} label="Active offers" value={overview.totalActiveOffers} tone="bg-secondary/12 text-secondary" />
        <Stat icon={<AlertTriangle className="h-5 w-5" />} label="Offers needing review" value={overview.offersNeedingReview} tone="bg-amber-500/12 text-amber-300" />
        <Stat icon={<Clock className="h-5 w-5" />} label="Stale offers" value={overview.staleOffers} tone="bg-amber-500/12 text-amber-300" />
        <Stat icon={<FileText className="h-5 w-5" />} label="Latest run" value={overview.latestRun ? relativeAge(overview.latestRun.startedAt, nowMs) : "—"} />
        <Stat icon={<Database className="h-5 w-5" />} label="Total offers" value={db.offers.length} />
      </div>

      <Card className="border-border/70 bg-surface/40">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Recent offers</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border/60"><th className="px-4 py-2">Product</th><th className="px-4 py-2">Retailer</th><th className="px-4 py-2">Price</th><th className="px-4 py-2">Trust</th><th className="px-4 py-2">Availability</th><th className="px-4 py-2">Freshness</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Evidence</th></tr>
            </thead>
            <tbody>
              {recent.map((o) => (
                <tr key={o.id} className="border-b border-border/40">
                  <td className="px-4 py-2">{productName(o.productId)}</td>
                  <td className="px-4 py-2">{retailerName(o.retailerId)}</td>
                  <td className="px-4 py-2 font-semibold">R{o.currentPrice.toLocaleString("en-ZA")}</td>
                  <td className="px-4 py-2"><TrustBadge label={o.priceTrustLabel} /></td>
                  <td className="px-4 py-2"><AvailabilityBadge label={o.availabilityScope} /></td>
                  <td className="px-4 py-2"><FreshnessBadge offer={o} nowMs={nowMs} /></td>
                  <td className="px-4 py-2"><PublishedBadge published={o.published} reviewStatus={o.reviewStatus} /></td>
                  <td className="px-4 py-2"><Button variant="glass" size="sm" onClick={() => onEvidence(o)}><FileText className="h-3 w-3" /> View</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Source registry ─────────────────────────────────────────────────────────────
function SourcesSection({ db, persist, nowMs, retailerName }: {
  db: IngestionDatabase; persist: (d: IngestionDatabase) => void; nowMs: number; retailerName: (id: string) => string;
}) {
  const [f, setF] = useState<Partial<SourceInput>>({ sourceType: "retailer_specials_page", status: "candidate", riskLevel: "medium" });
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: keyof SourceInput, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  const missing: string[] = [];
  if (!f.name?.trim()) missing.push("name");
  if (!isValidHttpUrl(f.sourceUrl)) missing.push("valid source URL");
  if (!f.sourceType) missing.push("source type");

  const submit = () => {
    if (missing.length) return;
    const input: SourceInput = {
      name: f.name!.trim(), sourceUrl: f.sourceUrl!, sourceType: f.sourceType as SourceType,
      retailerId: f.retailerId || null, mallId: f.mallId || null, status: (f.status as SourceRegistryStatus) ?? "candidate",
      riskLevel: (f.riskLevel as RiskLevel) ?? "medium",
      legalRiskNote: f.legalRiskNote?.trim() || null, ownerNotes: f.ownerNotes?.trim() || null,
    };
    const { db: next, source } = addSource(db, input, new Date().toISOString());
    persist(next);
    setMsg(`Registered “${source.name}” as ${source.status} (${source.riskLevel} risk). Nothing was fetched.`);
    setF({ sourceType: "retailer_specials_page", status: "candidate", riskLevel: "medium" });
  };

  const setStatus = (id: string, status: SourceRegistryStatus) => persist(decideSourceStatus(db, id, status, new Date().toISOString()));

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <label className="block space-y-1"><span className="text-xs font-medium text-muted-foreground">{label}</span>{children}</label>
  );

  return (
    <div className="space-y-4">
      <Card className="border-border/70 bg-surface/40">
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Globe className="h-4 w-4 text-primary" /> Register a source (registry only — no fetching)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Source name *"><input className={inputCls} value={f.name ?? ""} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Game — TV specials" /></Field>
            <Field label="Source URL *"><input className={inputCls} value={f.sourceUrl ?? ""} onChange={(e) => set("sourceUrl", e.target.value)} placeholder="https://…" /></Field>
            <Field label="Source type *">
              <select className={inputCls} value={f.sourceType} onChange={(e) => set("sourceType", e.target.value)}>
                {SOURCE_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select className={inputCls} value={f.status} onChange={(e) => set("status", e.target.value)}>
                {(Object.keys(SOURCE_STATUS_META) as SourceRegistryStatus[]).map((s) => <option key={s} value={s}>{SOURCE_STATUS_META[s].label}</option>)}
              </select>
            </Field>
            <Field label="Risk level">
              <select className={inputCls} value={f.riskLevel} onChange={(e) => set("riskLevel", e.target.value)}>
                {(Object.keys(RISK_LEVEL_META) as RiskLevel[]).map((r) => <option key={r} value={r}>{RISK_LEVEL_META[r].label}</option>)}
              </select>
            </Field>
            <Field label="Retailer (optional)">
              <select className={inputCls} value={f.retailerId ?? ""} onChange={(e) => set("retailerId", e.target.value)}>
                <option value="">— none —</option>
                {db.retailers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
            <Field label="Mall (optional)">
              <select className={inputCls} value={f.mallId ?? ""} onChange={(e) => set("mallId", e.target.value)}>
                <option value="">— none —</option>
                {db.malls.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Legal / risk note"><input className={inputCls} value={f.legalRiskNote ?? ""} onChange={(e) => set("legalRiskNote", e.target.value)} placeholder="e.g. Public specials page — no login wall" /></Field>
          <Field label="Owner notes"><textarea className={inputCls} rows={2} value={f.ownerNotes ?? ""} onChange={(e) => set("ownerNotes", e.target.value)} /></Field>
          {missing.length > 0 && <p className="text-xs text-amber-300">Add: {missing.join(", ")}.</p>}
          {msg && <div className="rounded-lg border border-secondary/40 bg-secondary/10 px-3 py-2 text-xs text-secondary">{msg}</div>}
          <Button variant="neon" size="sm" disabled={missing.length > 0} onClick={submit}><Globe className="h-3.5 w-3.5" /> Register source</Button>
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-surface/40">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Source registry ({db.sources.length})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[920px] text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border/60">
                <th className="px-4 py-2">Source</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">Retailer</th>
                <th className="px-4 py-2">Status</th><th className="px-4 py-2">Risk</th><th className="px-4 py-2">Legal / risk</th><th className="px-4 py-2">Last checked</th><th className="px-4 py-2">Set status</th>
              </tr>
            </thead>
            <tbody>
              {db.sources.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No sources registered yet.</td></tr>}
              {db.sources.map((s) => (
                <tr key={s.id} className="border-b border-border/40 align-top">
                  <td className="px-4 py-2">
                    <p className="font-medium">{s.name}</p>
                    <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="block max-w-[220px] truncate text-[11px] text-primary underline">{s.sourceUrl}</a>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{sourceTypeLabel(s.sourceType)}</td>
                  <td className="px-4 py-2 text-xs">{s.retailerId ? retailerName(s.retailerId) : "—"}</td>
                  <td className="px-4 py-2"><ToneBadge tone={SOURCE_STATUS_META[s.status].tone} title={SOURCE_STATUS_META[s.status].description}>{SOURCE_STATUS_META[s.status].label}</ToneBadge></td>
                  <td className="px-4 py-2"><ToneBadge tone={RISK_LEVEL_META[s.riskLevel].tone} title={RISK_LEVEL_META[s.riskLevel].description}>{RISK_LEVEL_META[s.riskLevel].label}</ToneBadge></td>
                  <td className="px-4 py-2 max-w-[200px] text-[11px] text-muted-foreground">{s.legalRiskNote ?? "—"}</td>
                  <td className="px-4 py-2 text-[11px] text-muted-foreground">{s.lastCheckedAt ? relativeAge(s.lastCheckedAt, nowMs) : "—"}</td>
                  <td className="px-4 py-2">
                    <select className={cn(inputCls, "w-36 py-1 text-xs")} value={s.status} onChange={(e) => setStatus(s.id, e.target.value as SourceRegistryStatus)}>
                      {(Object.keys(SOURCE_STATUS_META) as SourceRegistryStatus[]).map((st) => <option key={st} value={st}>{SOURCE_STATUS_META[st].label}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Review queue ──────────────────────────────────────────────────────────────
function ReviewSection({ db, persist, nowMs, productName, retailerName, onEvidence }: {
  db: IngestionDatabase; persist: (d: IngestionDatabase) => void; nowMs: number;
  productName: (id: string) => string; retailerName: (id: string) => string; onEvidence: (o: ProductOffer) => void;
}) {
  const [filter, setFilter] = useState<"staged" | "needs_review" | "approved" | "rejected" | "archived">("staged");
  const items = db.reviewQueue.filter((q) => q.status === filter);

  const decide = (offerId: string, decision: "approved" | "rejected" | "needs_review" | "archived") =>
    persist(decideOfferReview(db, offerId, decision, "admin", null, new Date().toISOString()));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-surface/40 p-1">
        {(["staged", "needs_review", "approved", "rejected", "archived"] as const).map((s) => (
          <button key={s} onClick={() => setFilter(s)} className={cn("rounded-lg px-3 py-1 text-xs font-medium", filter === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
            {s.replace("_", " ")} ({db.reviewQueue.filter((q) => q.status === s).length})
          </button>
        ))}
      </div>

      {items.length === 0 && <p className="rounded-xl border border-border/60 bg-surface/30 px-4 py-8 text-center text-sm text-muted-foreground">Nothing {filter.replace("_", " ")}.</p>}

      {items.map((q) => {
        const offer = db.offers.find((o) => o.id === q.entityId);
        return (
          <Card key={q.id} className="border-border/70 bg-surface/40">
            <CardContent className="space-y-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{offer ? `${productName(offer.productId)} — ${retailerName(offer.retailerId)}` : q.entityType}</p>
                  <p className="text-xs text-muted-foreground">{q.reason}</p>
                </div>
                {offer && <p className="text-lg font-bold">R{offer.currentPrice.toLocaleString("en-ZA")}</p>}
              </div>
              {offer && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <TrustBadge label={offer.priceTrustLabel} />
                  <AvailabilityBadge label={offer.availabilityScope} />
                  <FreshnessBadge offer={offer} nowMs={nowMs} />
                  <ToneBadge tone={q.severity === "error" ? "danger" : q.severity === "warning" ? "warning" : "muted"}>{q.severity}</ToneBadge>
                  <span className="text-[11px] text-muted-foreground">{relativeAge(offer.sourceObservedAt, nowMs)}</span>
                </div>
              )}
              {(q.status === "staged" || q.status === "needs_review") && offer && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button variant="neon" size="sm" onClick={() => decide(offer.id, "approved")}><CheckCircle2 className="h-3.5 w-3.5" /> Approve & publish</Button>
                  <Button variant="glass" size="sm" onClick={() => decide(offer.id, "needs_review")}><PencilLine className="h-3.5 w-3.5" /> Needs review</Button>
                  <Button variant="glass" size="sm" onClick={() => decide(offer.id, "rejected")}><XCircle className="h-3.5 w-3.5" /> Reject</Button>
                  <Button variant="glass" size="sm" onClick={() => decide(offer.id, "archived")}><FileText className="h-3.5 w-3.5" /> Archive</Button>
                  <Button variant="glass" size="sm" onClick={() => onEvidence(offer)}><FileText className="h-3.5 w-3.5" /> Evidence</Button>
                </div>
              )}
              {(q.status === "approved" || q.status === "rejected" || q.status === "archived") && <p className="text-[11px] text-muted-foreground">Decided {q.reviewedAt ? relativeAge(q.reviewedAt, nowMs) : ""} by {q.reviewedBy ?? "—"}.</p>}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ── Assistant preview ──────────────────────────────────────────────────────────
const MODE_LABEL: Record<RecommendationMode, string> = { normal: "Normal (governed)", curated_demo: "Curated demo", admin_preview: "Admin preview" };

function AssistantSection({ db, nowMs }: { db: IngestionDatabase; nowMs: number }) {
  const [budget, setBudget] = useState(4000);
  const [mode, setMode] = useState<RecommendationMode>("normal");
  const [intent, setIntent] = useState<"budget" | "cheapest">("budget");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const mallId = db.malls[0]?.id ?? "mall_reds";
  const fabric = useMemo(() => loadFabric(), []);
  const answer = useMemo(() => buildShopperAnswer(db, fabric, {
    mallId, category: "television", budget,
    intent: verifiedOnly ? "verified_only" : intent,
    trustPreference: verifiedOnly ? "verified_only" : "any",
  }, nowMs, mode), [db, fabric, mallId, budget, intent, verifiedOnly, mode, nowMs]);
  const d = answer.diagnostics;

  const OptionCard = ({ o }: { o: ShopperOption }) => (
    <Card className="border-border/70 bg-surface/50">
      <CardContent className="space-y-1.5 p-4">
        <div className="flex items-start justify-between gap-2">
          <div><p className="font-semibold">{o.productTitle}</p><p className="text-xs text-muted-foreground">{o.retailer}{o.storeTradingName ? ` · ${o.storeTradingName}` : ""}</p></div>
          <div className="text-right"><p className="text-xl font-bold text-primary">{o.priceFormatted}</p>{o.originalPrice && <p className="text-[11px] text-muted-foreground line-through">R{o.originalPrice.toLocaleString("en-ZA")}</p>}</div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <ToneBadge tone="info">{o.trustLabel}</ToneBadge>
          <ToneBadge tone={o.branchStock === "confirmed" ? "verified" : "warning"}>Branch stock {o.branchStock === "confirmed" ? "confirmed" : "not confirmed"}</ToneBadge>
        </div>
        <p className="text-[11px] text-muted-foreground">{o.freshnessStatement}</p>
        <p className="text-[11px] text-muted-foreground">{o.scopeStatement}</p>
        <p className="text-[11px] text-muted-foreground">{o.availabilityStatement}</p>
        {o.expiry && <p className="text-[11px] text-amber-300">Valid until {new Date(o.expiry).toLocaleDateString()}.</p>}
        <p className="text-[11px] text-muted-foreground"><b>Why:</b> {o.explanation}</p>
        {o.routeAction && <ToneBadge tone="fresh">In-store route available — {o.routeAction.storeTradingName}</ToneBadge>}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      <Card className="border-border/70 bg-surface/40">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <label className="space-y-1"><span className="text-xs text-muted-foreground">Mode</span>
            <select className={cn(inputCls, "w-44")} value={mode} onChange={(e) => setMode(e.target.value as RecommendationMode)}>
              {(Object.keys(MODE_LABEL) as RecommendationMode[]).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
            </select>
          </label>
          <label className="space-y-1"><span className="text-xs text-muted-foreground">Intent</span>
            <select className={cn(inputCls, "w-32")} value={intent} onChange={(e) => setIntent(e.target.value as "budget" | "cheapest")} disabled={verifiedOnly}>
              <option value="budget">Budget</option><option value="cheapest">Cheapest</option>
            </select>
          </label>
          <label className="space-y-1"><span className="text-xs text-muted-foreground">Max budget (R)</span><input className={cn(inputCls, "w-28")} type="number" value={budget} onChange={(e) => setBudget(Number(e.target.value) || 0)} /></label>
          <label className="flex items-center gap-2 self-end pb-2 text-xs"><input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} /> Verified only</label>
          <div className="text-xs text-muted-foreground">Query: <b className="text-foreground">“{verifiedOnly ? "Verified TVs only" : intent === "cheapest" ? "Cheapest TV" : `TV under R${budget.toLocaleString("en-ZA")}`} at Mall@Reds.”</b></div>
        </CardContent>
      </Card>

      <div>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-bold"><Sparkles className="h-4 w-4 text-secondary" /> {answer.headline}</h3>
        <div className="grid gap-3 md:grid-cols-2">{answer.options.map((o) => <OptionCard key={o.offerId} o={o} />)}</div>
        {answer.options.length === 0 && <p className="text-sm text-muted-foreground">No offers returned for this query and mode.</p>}
      </div>

      {/* Observability (admin surface — not shopper-facing) */}
      <Card className="border-border/70 bg-surface/40">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Retrieval diagnostics (admin only — never shown to shoppers)</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2 p-4 text-[11px]">
          <ToneBadge tone="muted">Considered {d.totalConsidered}</ToneBadge>
          <ToneBadge tone="verified">Eligible {d.eligible}</ToneBadge>
          <ToneBadge tone="warning">Review {d.excludedByReview}</ToneBadge>
          <ToneBadge tone="warning">Publication {d.excludedByPublication}</ToneBadge>
          <ToneBadge tone="warning">Stale/expired {d.excludedStaleExpired}</ToneBadge>
          <ToneBadge tone="warning">Unavailable {d.excludedUnavailable}</ToneBadge>
          <ToneBadge tone="danger">Conflict {d.excludedConflict}</ToneBadge>
          <ToneBadge tone="warning">No evidence {d.excludedMissingEvidence}</ToneBadge>
          <ToneBadge tone="muted">Mall/store {d.excludedMallStoreMismatch}</ToneBadge>
          {verifiedOnly && <ToneBadge tone="muted">Not verified {d.excludedNotVerified}</ToneBadge>}
        </CardContent>
      </Card>

      {mode === "admin_preview" && d.exclusions.length > 0 && (
        <Card className="border-border/70 bg-surface/40">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Excluded offers (admin preview — blockers visible, never publishable)</CardTitle></CardHeader>
          <CardContent className="space-y-1 p-4 text-[11px] text-muted-foreground">
            {d.exclusions.slice(0, 12).map((x) => (
              <p key={x.offerId}>{x.offerId}: <span className="text-red-300">{x.reasons.join(", ")}</span></p>
            ))}
          </CardContent>
        </Card>
      )}

      <p className="rounded-lg border border-border/60 bg-surface/30 px-3 py-2 text-[11px] text-muted-foreground">{answer.disclosure}</p>
    </div>
  );
}
