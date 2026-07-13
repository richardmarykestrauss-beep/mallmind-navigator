/**
 * /admin/data-ingestion — MallMind Data Ingestion Sprint 1 (Prototype).
 *
 * A working admin surface over the local ("Prototype — local persisted data")
 * ingestion store: overview, CSV import with preview/approval, manual offer entry
 * with publish gating, a review queue, an evidence panel, and an assistant
 * preview generated from the model. Curated demonstration data only — no live
 * scraping, no fake integrations, no dead buttons.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Database, Store as StoreIcon, Package, Tag, AlertTriangle, Clock, Upload, Download,
  ShieldCheck, FileText, Sparkles, RotateCcw, ArrowLeft, CheckCircle2, XCircle, PencilLine, Globe, LayoutDashboard,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  loadDatabase, saveDatabase, resetToSeed, computeOverview, addOffer, decideOfferReview,
  commitOfferCsv, addSource, decideSourceStatus, type OfferInput, type SourceInput,
} from "@/lib/ingestion/store";
import {
  parseCsv, templateCsvString, previewOffersCsv, type CsvPreview,
} from "@/lib/ingestion/csv";
import { buildTvUnderBudgetAnswer } from "@/lib/ingestion/recommend";
import { PRICE_TRUST_LABELS, AVAILABILITY_LABELS } from "@/lib/ingestion/labels";
import { relativeAge } from "@/lib/ingestion/freshness";
import { isValidHttpUrl } from "@/lib/ingestion/validation";
import { SOURCE_TYPE_OPTIONS, SOURCE_STATUS_META } from "@/components/ingestion/ingestionMeta";
import type { IngestionDatabase, ProductOffer, SourceType, SourceRegistryStatus } from "@/lib/ingestion/model";
import { TrustBadge, AvailabilityBadge, AvailabilityStatusBadge, FreshnessBadge, PublishedBadge, ToneBadge } from "@/components/ingestion/badges";

const inputCls = "w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60";
const TABS = ["overview", "sources", "csv", "manual", "review", "assistant"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { overview: "Overview", sources: "Sources", csv: "CSV import", manual: "Manual offer", review: "Review queue", assistant: "Assistant preview" };

function downloadCsv(kind: "offers" | "products" | "stores") {
  const blob = new Blob([templateCsvString(kind)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `mallmind-${kind}-template.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

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

// ── CSV import ────────────────────────────────────────────────────────────────
function CsvSection({ db, persist }: { db: IngestionDatabase; persist: (d: IngestionDatabase) => void }) {
  const [fileName, setFileName] = useState<string>("");
  const [preview, setPreview] = useState<CsvPreview<ProductOffer> | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    const text = await file.text();
    setPreview(previewOffersCsv(parseCsv(text).rows, db, new Date().toISOString()));
  };

  const approve = () => {
    if (!preview) return;
    const accepted = preview.results.filter((r) => r.status === "accepted").map((r) => r.entity!).filter(Boolean);
    const warned = preview.results.filter((r) => r.status === "warning" && r.entity).map((r) => ({ offer: r.entity!, reason: r.issues.map((i) => i.message).join("; ") }));
    const newProducts = preview.results.filter((r) => r.status !== "rejected" && r.newProduct).map((r) => r.newProduct!);
    const { db: next, run } = commitOfferCsv(db, accepted, warned, { filename: fileName, initiatedBy: "admin", totalRows: preview.totalRows, rejectedRows: preview.rejectedRows }, new Date().toISOString(), newProducts);
    persist(next);
    setResult(`Imported ${run.acceptedRows} accepted + ${run.warningRows} with warnings (queued for review). ${preview.rejectedRows} rejected. Run ${run.id.slice(0, 12)} recorded.`);
    setPreview(null);
  };

  return (
    <div className="space-y-4">
      <Card className="border-border/70 bg-surface/40">
        <CardHeader className="pb-2"><CardTitle className="text-sm">CSV templates</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {(["products", "stores", "offers"] as const).map((k) => (
            <Button key={k} variant="glass" size="sm" onClick={() => downloadCsv(k)}><Download className="h-3.5 w-3.5" /> {k} template</Button>
          ))}
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-surface/40">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Import product offers (CSV)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-primary/40 bg-primary/5 px-4 py-6 text-sm">
            <Upload className="h-5 w-5 text-primary" />
            <span>{fileName || "Choose a CSV file to parse & preview"}</span>
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
          </label>

          {result && <div className="rounded-lg border border-secondary/40 bg-secondary/10 px-3 py-2 text-xs text-secondary">{result}</div>}

          {preview && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2 text-xs">
                <ToneBadge tone="verified">{preview.acceptedRows} accepted</ToneBadge>
                <ToneBadge tone="warning">{preview.warningRows} warnings</ToneBadge>
                <ToneBadge tone="danger">{preview.rejectedRows} rejected</ToneBadge>
              </div>
              <div className="max-h-80 overflow-auto rounded-lg border border-border/60">
                <table className="w-full min-w-[640px] text-xs">
                  <thead className="sticky top-0 bg-surface text-left uppercase text-muted-foreground">
                    <tr><th className="px-3 py-2">Row</th><th className="px-3 py-2">Product</th><th className="px-3 py-2">Retailer</th><th className="px-3 py-2">Price</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Issues</th></tr>
                  </thead>
                  <tbody>
                    {preview.results.map((r) => (
                      <tr key={r.rowNumber} className="border-t border-border/40">
                        <td className="px-3 py-2">{r.rowNumber}</td>
                        <td className="px-3 py-2">{r.raw.product_title}</td>
                        <td className="px-3 py-2">{r.raw.retailer}</td>
                        <td className="px-3 py-2">{r.raw.price}</td>
                        <td className="px-3 py-2">{r.status === "accepted" ? <ToneBadge tone="verified">Accepted</ToneBadge> : r.status === "warning" ? <ToneBadge tone="warning">Warning</ToneBadge> : <ToneBadge tone="danger">Rejected</ToneBadge>}</td>
                        <td className="px-3 py-2 text-muted-foreground">{r.issues.map((i) => i.message).join("; ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-2">
                <Button variant="neon" size="sm" disabled={preview.acceptedRows + preview.warningRows === 0} onClick={approve}>
                  <CheckCircle2 className="h-3.5 w-3.5" /> Approve valid rows ({preview.acceptedRows + preview.warningRows})
                </Button>
                <Button variant="glass" size="sm" onClick={() => setPreview(null)}>Discard</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Source registry / Add snapshot (3rd ingestion path) ─────────────────────────
function SourcesSection({ db, persist, nowMs, retailerName }: {
  db: IngestionDatabase; persist: (d: IngestionDatabase) => void; nowMs: number; retailerName: (id: string) => string;
}) {
  const [f, setF] = useState<Partial<SourceInput>>({ sourceType: "retailer_specials_page", status: "candidate" });
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
      legalRiskNote: f.legalRiskNote?.trim() || null, ownerNotes: f.ownerNotes?.trim() || null,
    };
    const { db: next, source } = addSource(db, input, new Date().toISOString());
    persist(next);
    setMsg(`Registered “${source.name}” as ${source.status}. A source_snapshot run was recorded — no page was fetched.`);
    setF({ sourceType: "retailer_specials_page", status: "candidate" });
  };

  const setStatus = (id: string, status: SourceRegistryStatus) => persist(decideSourceStatus(db, id, status, new Date().toISOString()));

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <label className="block space-y-1"><span className="text-xs font-medium text-muted-foreground">{label}</span>{children}</label>
  );

  return (
    <div className="space-y-4">
      <Card className="border-border/70 bg-surface/40">
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Globe className="h-4 w-4 text-primary" /> Add source snapshot (registry only — no fetching)</CardTitle></CardHeader>
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
          <table className="w-full min-w-[820px] text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border/60">
                <th className="px-4 py-2">Source</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">Retailer</th>
                <th className="px-4 py-2">Status</th><th className="px-4 py-2">Legal / risk</th><th className="px-4 py-2">Last checked</th><th className="px-4 py-2">Set status</th>
              </tr>
            </thead>
            <tbody>
              {db.sources.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No sources registered yet.</td></tr>}
              {db.sources.map((s) => (
                <tr key={s.id} className="border-b border-border/40 align-top">
                  <td className="px-4 py-2">
                    <p className="font-medium">{s.name}</p>
                    <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="block max-w-[220px] truncate text-[11px] text-primary underline">{s.sourceUrl}</a>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{s.sourceType.replace(/_/g, " ")}</td>
                  <td className="px-4 py-2 text-xs">{s.retailerId ? retailerName(s.retailerId) : "—"}</td>
                  <td className="px-4 py-2"><ToneBadge tone={SOURCE_STATUS_META[s.status].tone} title={SOURCE_STATUS_META[s.status].description}>{SOURCE_STATUS_META[s.status].label}</ToneBadge></td>
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

// ── Manual offer ──────────────────────────────────────────────────────────────
function ManualOfferSection({ db, persist, onDone }: { db: IngestionDatabase; persist: (d: IngestionDatabase) => void; onDone: () => void }) {
  const [f, setF] = useState<Partial<OfferInput>>({
    currency: "ZAR", channel: "in_store", sourceType: "manual_admin", priceTrustLabel: "manual_admin",
    availabilityScope: "availability_unknown", branchEvidencePresent: false, sourceObservedAt: new Date().toISOString().slice(0, 16),
  });
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: keyof OfferInput, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  const missing: string[] = [];
  if (!f.productId) missing.push("product");
  if (!f.retailerId) missing.push("retailer");
  if (!(Number(f.currentPrice) > 0)) missing.push("valid price");
  if (!isValidHttpUrl(f.sourceUrl)) missing.push("source URL");
  if (!f.sourceObservedAt) missing.push("observed timestamp");
  if (!f.priceTrustLabel) missing.push("trust label");
  const branchWarn = f.availabilityScope === "branch_stock_confirmed" && !f.branchEvidencePresent;

  const submit = () => {
    if (missing.length) return;
    const input: OfferInput = {
      productId: f.productId!, retailerId: f.retailerId!, sellerName: f.sellerName ?? null, channel: f.channel!,
      currency: f.currency!, currentPrice: Number(f.currentPrice), previousPrice: f.previousPrice != null ? Number(f.previousPrice) : null,
      promotionLabel: f.promotionLabel ?? null, sourceUrl: f.sourceUrl!, sourceType: f.sourceType!,
      sourceObservedAt: new Date(f.sourceObservedAt!).toISOString(), validUntil: f.validUntil ? new Date(f.validUntil).toISOString() : null,
      availabilityScope: f.availabilityScope!, priceTrustLabel: f.priceTrustLabel!, branchEvidencePresent: !!f.branchEvidencePresent, notes: f.notes ?? null,
    };
    const { db: next, issues } = addOffer(db, input, new Date().toISOString());
    persist(next);
    setMsg(`Offer staged for review${issues.length ? ` with ${issues.length} flag(s)` : ""}. Approve it in the Review queue to publish.`);
    setTimeout(onDone, 900);
  };

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <label className="block space-y-1"><span className="text-xs font-medium text-muted-foreground">{label}</span>{children}</label>
  );

  return (
    <Card className="border-border/70 bg-surface/40">
      <CardHeader className="pb-2"><CardTitle className="text-sm">Add a single product offer</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Product *">
            <select className={inputCls} value={f.productId ?? ""} onChange={(e) => set("productId", e.target.value)}>
              <option value="">Select a product…</option>
              {db.products.map((p) => <option key={p.id} value={p.id}>{p.canonicalName}</option>)}
            </select>
          </Field>
          <Field label="Retailer *">
            <select className={inputCls} value={f.retailerId ?? ""} onChange={(e) => set("retailerId", e.target.value)}>
              <option value="">Select a retailer…</option>
              {db.retailers.map((r) => <option key={r.id} value={r.id}>{r.name}{r.physicalRetailer ? "" : " (online)"}</option>)}
            </select>
          </Field>
          <Field label="Channel"><select className={inputCls} value={f.channel} onChange={(e) => set("channel", e.target.value)}>{["in_store", "online", "marketplace", "click_and_collect", "catalogue"].map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
          <Field label="Seller name (marketplace)"><input className={inputCls} value={f.sellerName ?? ""} onChange={(e) => set("sellerName", e.target.value)} placeholder="e.g. TechDeals SA" /></Field>
          <Field label="Current price (R) *"><input className={inputCls} type="number" value={f.currentPrice ?? ""} onChange={(e) => set("currentPrice", e.target.value)} /></Field>
          <Field label="Previous price (R)"><input className={inputCls} type="number" value={f.previousPrice ?? ""} onChange={(e) => set("previousPrice", e.target.value)} /></Field>
          <Field label="Source URL *"><input className={inputCls} value={f.sourceUrl ?? ""} onChange={(e) => set("sourceUrl", e.target.value)} placeholder="https://…" /></Field>
          <Field label="Source type"><select className={inputCls} value={f.sourceType} onChange={(e) => set("sourceType", e.target.value)}>{["retailer_product_page", "retailer_catalogue", "marketplace_listing", "manual_admin", "user_submission", "phone_confirmation", "in_store_photo"].map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
          <Field label="Observed at *"><input className={inputCls} type="datetime-local" value={f.sourceObservedAt ?? ""} onChange={(e) => set("sourceObservedAt", e.target.value)} /></Field>
          <Field label="Valid until (promotions)"><input className={inputCls} type="datetime-local" value={f.validUntil ?? ""} onChange={(e) => set("validUntil", e.target.value)} /></Field>
          <Field label="Price trust label *"><select className={inputCls} value={f.priceTrustLabel} onChange={(e) => set("priceTrustLabel", e.target.value)}>{Object.values(PRICE_TRUST_LABELS).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select></Field>
          <Field label="Availability label"><select className={inputCls} value={f.availabilityScope} onChange={(e) => set("availabilityScope", e.target.value)}>{Object.values(AVAILABILITY_LABELS).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select></Field>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!f.branchEvidencePresent} onChange={(e) => set("branchEvidencePresent", e.target.checked)} />
          Branch-specific evidence present (phone / in-store / staff confirmation)
        </label>
        {branchWarn && (
          <div className="flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            <AlertTriangle className="h-4 w-4" /> "Branch stock confirmed" requires branch-specific evidence — this offer will be flagged for review, not published.
          </div>
        )}
        <label className="block space-y-1"><span className="text-xs font-medium text-muted-foreground">Notes</span><textarea className={inputCls} rows={2} value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></label>

        {missing.length > 0 && <p className="text-xs text-amber-300">Publishing is blocked until: {missing.join(", ")}.</p>}
        {msg && <div className="rounded-lg border border-secondary/40 bg-secondary/10 px-3 py-2 text-xs text-secondary">{msg}</div>}
        <Button variant="neon" size="sm" disabled={missing.length > 0} onClick={submit}><PencilLine className="h-3.5 w-3.5" /> Create offer (staged for review)</Button>
      </CardContent>
    </Card>
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
function AssistantSection({ db, nowMs }: { db: IngestionDatabase; nowMs: number }) {
  const [budget, setBudget] = useState(4000);
  const mallId = db.malls[0]?.id ?? "mall_reds";
  const answer = useMemo(() => buildTvUnderBudgetAnswer(db, { mallId, maxPrice: budget, nowMs }), [db, mallId, budget, nowMs]);

  const OfferCard = ({ o, showWhy }: { o: (typeof answer.primary)[number]; showWhy: boolean }) => (
    <Card className="border-border/70 bg-surface/50">
      <CardContent className="space-y-1.5 p-4">
        <div className="flex items-start justify-between gap-2">
          <div><p className="font-semibold">{o.productName}</p><p className="text-xs text-muted-foreground">{o.retailerName}{o.sellerName ? ` · seller: ${o.sellerName}` : ""} · {o.channel}</p></div>
          <p className="text-xl font-bold text-primary">{o.priceFormatted}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <ToneBadge tone={o.priceTrust.tone}>{o.priceTrust.label}</ToneBadge>
          <ToneBadge tone={o.availability.tone}>{o.availability.label}</ToneBadge>
          <span className="text-[11px] text-muted-foreground">Observed {o.observedRelative}</span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]">
          <span>Store at Mall@Reds: <b className={o.storeAtMall === "confirmed" ? "text-secondary" : "text-muted-foreground"}>{o.storeAtMall === "confirmed" ? "Confirmed" : "Not a mall store"}</b></span>
          <span>Branch stock: <b className={o.branchStock === "confirmed" ? "text-secondary" : "text-amber-300"}>{o.branchStock === "confirmed" ? "Confirmed" : "Not confirmed"}</b></span>
          <span className="text-muted-foreground">Source: {o.sourceType.replace(/_/g, " ")}</span>
        </div>
        {showWhy && o.whyRecommended && <p className="text-xs text-muted-foreground"><b>Why:</b> {o.whyRecommended}</p>}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      <Card className="border-border/70 bg-surface/40">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <label className="space-y-1"><span className="text-xs text-muted-foreground">Max budget (R)</span><input className={cn(inputCls, "w-32")} type="number" value={budget} onChange={(e) => setBudget(Number(e.target.value) || 0)} /></label>
          <div className="text-xs text-muted-foreground">Query: <b className="text-foreground">“I need a TV under R{budget.toLocaleString("en-ZA")} at Mall@Reds.”</b> — generated from the ingestion model.</div>
        </CardContent>
      </Card>

      <div>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-bold"><Sparkles className="h-4 w-4 text-secondary" /> {answer.headline}</h3>
        <div className="grid gap-3 md:grid-cols-2">{answer.primary.map((o) => <OfferCard key={o.offerId} o={o} showWhy />)}</div>
        {answer.primary.length === 0 && <p className="text-sm text-muted-foreground">No qualifying in-mall offers under budget.</p>}
      </div>

      {answer.onlineComparisons.length > 0 && (
        <div>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-muted-foreground"><Package className="h-4 w-4" /> Online comparison (not a Mall@Reds store)</h3>
          <div className="grid gap-3 md:grid-cols-2">{answer.onlineComparisons.map((o) => <OfferCard key={o.offerId} o={o} showWhy={false} />)}</div>
        </div>
      )}

      <p className="rounded-lg border border-border/60 bg-surface/30 px-3 py-2 text-[11px] text-muted-foreground">{answer.disclosure}</p>
    </div>
  );
}

// ── Evidence panel ────────────────────────────────────────────────────────────
function EvidenceDialog({ db, offer, onClose, nowMs, productName, retailerName }: {
  db: IngestionDatabase; offer: ProductOffer | null; onClose: () => void; nowMs: number;
  productName: (id: string) => string; retailerName: (id: string) => string;
}) {
  const snapshots = offer ? db.snapshots.filter((s) => (s.evidenceMetadata as { offerId?: string }).offerId === offer.id || s.sourceUrl === offer.sourceUrl) : [];
  const observations = offer ? db.observations.filter((o) => o.productOfferId === offer.id) : [];
  return (
    <Dialog open={!!offer} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><FileText className="h-4 w-4 text-primary" /> Source evidence</DialogTitle></DialogHeader>
        {offer && (
          <div className="space-y-3 text-sm">
            <div className="rounded-lg border border-border/60 bg-surface/40 p-3">
              <p className="font-semibold">{productName(offer.productId)} — {retailerName(offer.retailerId)}</p>
              <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>Price: <b className="text-foreground">R{offer.currentPrice.toLocaleString("en-ZA")}</b></span>
                <span>Observed: {relativeAge(offer.sourceObservedAt, nowMs)}</span>
                <span>Source type: {offer.sourceType.replace(/_/g, " ")}</span>
                <span>Review: {offer.reviewStatus}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <TrustBadge label={offer.priceTrustLabel} />
                <AvailabilityStatusBadge status={offer.availabilityStatus} />
                <FreshnessBadge offer={offer} nowMs={nowMs} />
              </div>
              <a href={offer.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block break-all text-xs text-primary underline">{offer.sourceUrl}</a>
            </div>
            <p className="text-xs font-semibold text-muted-foreground">Stored snapshots ({snapshots.length})</p>
            {snapshots.length === 0 && <p className="text-xs text-muted-foreground">No stored snapshot for this offer.</p>}
            {snapshots.map((s) => (
              <div key={s.id} className="rounded-lg border border-border/60 bg-surface/30 p-3 text-xs">
                <p className="text-foreground">{s.evidenceExcerpt}</p>
                <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
                  <span>Retrieved: {new Date(s.retrievedAt).toLocaleString()}</span>
                  <span>Parser: {s.parserVersion}</span>
                  <span>Content hash: {s.contentHash}</span>
                  <span>Status: {s.status}</span>
                </div>
              </div>
            ))}
            {observations.length > 0 && (
              <>
                <p className="text-xs font-semibold text-muted-foreground">Branch observations ({observations.length})</p>
                {observations.map((o) => (
                  <div key={o.id} className="rounded-lg border border-secondary/30 bg-secondary/8 p-3 text-xs">
                    {o.evidenceType.replace(/_/g, " ")} — {o.availabilityStatus.replace(/_/g, " ")} · confidence {Math.round(o.confidenceScore * 100)}% · {relativeAge(o.observedAt, nowMs)}
                  </div>
                ))}
              </>
            )}
            <p className="text-[11px] text-muted-foreground">Curated demonstration evidence — no live page captures or screenshots are stored.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
