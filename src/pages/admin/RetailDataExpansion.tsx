/**
 * RetailDataExpansion.tsx
 *
 * Admin Control Room: Retail Data Expansion
 *
 * PURPOSE
 * ────────
 * Centralised dashboard for growing MallMind's product/shop dataset from
 * ~110 products toward 500–1,000 staged findings. Provides visibility over
 * dataset coverage, staged batch items, review queue, source campaigns, and
 * launch readiness — all without writing live data.
 *
 * SAFETY RULES
 * ─────────────
 * • Never auto-writes to products / shops / mall_nodes.
 * • "Approved" means staged/accepted in the research queue — NOT live.
 * • Apply-to-live is a separate, future workflow (Sprint 12C / 15).
 * • All backend calls require admin bearer token.
 *
 * DEGRADATION
 * ────────────
 * When VITE_GOOGLE_BACKEND_URL is not set, Supabase-sourced metrics (products,
 * shops, malls) still display. Backend-sourced metrics (batches, findings,
 * sources) show "Not tracked yet".
 */

import { useState, useEffect, useCallback } from "react";
import {
  TrendingUp, Package, Store, Database, AlertCircle, AlertTriangle,
  CheckCircle2, Globe, Plus, RefreshCw, Loader2, ExternalLink,
  Shield, ShieldCheck, ChevronRight, ArrowRight, MapPin,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase, type Mall } from "@/lib/supabaseClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  getMallResearchBatches,
  getMallDataSources,
  getMallDataFindings,
  createMallDataSource,
  type MallResearchBatch,
  type MallDataSource,
  type MallDataFinding,
  type MallDataSourceType,
  type MallDataFindingStatus,
} from "@/lib/googleBackendClient";

// ── Prop types ────────────────────────────────────────────────────────────────

interface ProductCounts {
  total: number;
  manually_verified: number;
  live_feed: number;
  needs_review: number;
  demo: number;
  stale: number;
  user_submitted: number;
}

interface CoverageCounts {
  malls: number;
  shops: number;
  products: ProductCounts;
}

interface RetailDataExpansionProps {
  /** Supabase-sourced product/shop/mall counts from AdminDashboard. */
  counts: CoverageCounts | null;
  /** Admin JWT for backend API calls. */
  token: string | undefined;
  /** Whether VITE_GOOGLE_BACKEND_URL is configured. */
  backendOk: boolean;
  /** Navigate to another admin tab by id. */
  onSwitchTab: (tab: string) => void;
}

// ── Source quality config ─────────────────────────────────────────────────────

type SourceStrength = "strong" | "medium" | "weak";

interface SourceQuality {
  label: string;
  colorClass: string;
  strength: SourceStrength;
}

const SOURCE_QUALITY: Record<string, SourceQuality> = {
  official_website: {
    label:       "Retailer Official",
    colorClass:  "bg-emerald-100 text-emerald-800 border-emerald-200",
    strength:    "strong",
  },
  retail_directory: {
    label:       "Mall Directory",
    colorClass:  "bg-cyan-100 text-cyan-800 border-cyan-200",
    strength:    "strong",
  },
  manual_survey: {
    label:       "Admin Entered",
    colorClass:  "bg-violet-100 text-violet-800 border-violet-200",
    strength:    "strong",
  },
  public_flyer: {
    label:       "Public Flyer",
    colorClass:  "bg-amber-100 text-amber-800 border-amber-200",
    strength:    "medium",
  },
  press_release: {
    label:       "Press Release",
    colorClass:  "bg-blue-100 text-blue-800 border-blue-200",
    strength:    "medium",
  },
  social_media: {
    label:       "Social Media ⚠",
    colorClass:  "bg-orange-100 text-orange-800 border-orange-200",
    strength:    "weak",
  },
  other: {
    label:       "Unknown Source",
    colorClass:  "bg-muted text-muted-foreground border-border",
    strength:    "weak",
  },
};

const StrengthIcon = ({ strength }: { strength: SourceStrength }) => {
  if (strength === "strong") return <ShieldCheck className="h-2.5 w-2.5 shrink-0" />;
  if (strength === "medium") return <Shield className="h-2.5 w-2.5 shrink-0" />;
  return <AlertCircle className="h-2.5 w-2.5 shrink-0" />;
};

function SourceQualityBadge({ type }: { type: string }) {
  const q = SOURCE_QUALITY[type] ?? SOURCE_QUALITY.other;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap",
      q.colorClass,
    )}>
      <StrengthIcon strength={q.strength} />
      {q.label}
    </span>
  );
}

// ── Launch readiness heuristic ────────────────────────────────────────────────

interface ReadinessConfig {
  label:       string;
  description: string;
  borderClass: string;
  bgClass:     string;
  iconClass:   string;
  textClass:   string;
}

function getReadiness(total: number): ReadinessConfig {
  if (total < 250) return {
    label:       "Weak dataset",
    description: "Most product searches will return no results. Expand data before public launch.",
    borderClass: "border-red-300",
    bgClass:     "bg-red-50/60",
    iconClass:   "bg-red-100 text-red-600",
    textClass:   "text-red-700",
  };
  if (total < 500) return {
    label:       "Improving",
    description: "Basic coverage. Some searches will work. Keep adding data.",
    borderClass: "border-amber-300",
    bgClass:     "bg-amber-50/60",
    iconClass:   "bg-amber-100 text-amber-700",
    textClass:   "text-amber-800",
  };
  if (total < 1000) return {
    label:       "Pilot ready",
    description: "Sufficient coverage for a controlled pilot launch. Keep expanding.",
    borderClass: "border-cyan-300",
    bgClass:     "bg-cyan-50/60",
    iconClass:   "bg-cyan-100 text-cyan-700",
    textClass:   "text-cyan-800",
  };
  return {
    label:       "Strong dataset",
    description: "Good product coverage for a public launch.",
    borderClass: "border-emerald-300",
    bgClass:     "bg-emerald-50/60",
    iconClass:   "bg-emerald-100 text-emerald-700",
    textClass:   "text-emerald-800",
  };
}

// ── Small stat tile ───────────────────────────────────────────────────────────

function StatTile({
  label, value, sub, icon, iconClass = "",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon: React.ReactNode;
  iconClass?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
        <span className={cn("text-muted-foreground", iconClass)}>{icon}</span>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold leading-none">{value}</div>
        {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RetailDataExpansion({
  counts,
  token,
  backendOk,
  onSwitchTab,
}: RetailDataExpansionProps) {

  // ── Backend data state ──────────────────────────────────────────────────────
  const [batches, setBatches]         = useState<MallResearchBatch[]>([]);
  const [batchesLoading, setBL]       = useState(false);
  const [batchesError, setBatchesErr] = useState<string | null>(null);

  const [findings, setFindings]         = useState<MallDataFinding[]>([]);
  const [findingsLoading, setFL]        = useState(false);
  const [findingsError, setFindingsErr] = useState<string | null>(null);

  const [sources, setSources]           = useState<MallDataSource[]>([]);
  const [sourcesLoading, setSL]         = useState(false);
  const [sourcesError, setSourcesErr]   = useState<string | null>(null);

  // ── Campaign planner form state ─────────────────────────────────────────────
  const [malls, setMalls]                     = useState<Pick<Mall, "id" | "name">[]>([]);
  const [showAddSource, setShowAddSource]     = useState(false);
  const [newMallId, setNewMallId]             = useState("");
  const [newLabel, setNewLabel]               = useState("");
  const [newUrl, setNewUrl]                   = useState("");
  const [newType, setNewType]                 = useState<MallDataSourceType>("official_website");
  const [adding, setAdding]                   = useState(false);
  const [addError, setAddError]               = useState<string | null>(null);

  // ── Load backend data ───────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    if (!backendOk || !token) return;

    setBL(true);  setBatchesErr(null);
    setFL(true);  setFindingsErr(null);
    setSL(true);  setSourcesErr(null);

    const [br, fr, sr] = await Promise.allSettled([
      getMallResearchBatches(token),
      getMallDataFindings(token),
      getMallDataSources(token),
    ]);

    if (br.status === "fulfilled") setBatches(br.value.batches);
    else setBatchesErr((br.reason as Error)?.message ?? "Failed to load batches");
    setBL(false);

    if (fr.status === "fulfilled") setFindings(fr.value.findings);
    else setFindingsErr((fr.reason as Error)?.message ?? "Failed to load findings");
    setFL(false);

    if (sr.status === "fulfilled") setSources(sr.value.sources);
    else setSourcesErr((sr.reason as Error)?.message ?? "Failed to load sources");
    setSL(false);
  }, [backendOk, token]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Malls for dropdown ──────────────────────────────────────────────────────
  useEffect(() => {
    supabase
      .from("malls")
      .select("id, name")
      .order("name")
      .then(({ data }) => setMalls((data ?? []) as Pick<Mall, "id" | "name">[]));
  }, []);

  // ── Computed aggregates ─────────────────────────────────────────────────────

  const liveProducts     = counts ? counts.products.manually_verified + counts.products.live_feed : null;
  const totalStaged      = batches.reduce((s, b) => s + (b.item_count ?? 0), 0);
  const totalReviewed    = batches.reduce((s, b) => s + (b.reviewed_count ?? 0), 0);
  const pendingBatch     = Math.max(0, totalStaged - totalReviewed);
  const totalCoverage    = (liveProducts ?? 0) + totalStaged;
  const readiness        = getReadiness(totalCoverage);

  const byFindingStatus  = (s: MallDataFindingStatus) => findings.filter((f) => f.status === s).length;

  // ── Add source handler ──────────────────────────────────────────────────────

  async function handleAddSource() {
    if (!token || !newMallId || !newLabel.trim()) return;
    setAdding(true);
    setAddError(null);
    try {
      await createMallDataSource(
        { mall_id: newMallId, label: newLabel.trim(), source_type: newType, source_url: newUrl || null },
        token
      );
      setNewMallId(""); setNewLabel(""); setNewUrl(""); setNewType("official_website");
      setShowAddSource(false);
      // Reload sources
      const { sources: fresh } = await getMallDataSources(token);
      setSources(fresh);
    } catch (e) {
      setAddError((e as Error)?.message ?? "Failed to add source");
    } finally {
      setAdding(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8">

      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Retail Data Expansion Control Room</h2>
          <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">
            Grow the dataset from ~110 products toward 500–1,000 staged findings. Track coverage, manage
            source campaigns, and monitor the review queue. No data leaves staging without explicit admin
            approval — apply-to-live is a separate workflow.
          </p>
        </div>
        <button
          onClick={loadData}
          disabled={!backendOk || batchesLoading}
          className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", batchesLoading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {/* ── Section 1: Dataset Coverage ──────────────────────────────────────── */}
      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Dataset Coverage
        </h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">

          {/* Live products */}
          <StatTile
            label="Live Products"
            icon={<Package className="h-3.5 w-3.5" />}
            iconClass="text-emerald-500"
            value={counts ? <>{liveProducts}</> : <span className="text-sm text-muted-foreground">…</span>}
            sub={counts ? `${counts.products.total} total incl. demo/stale` : undefined}
          />

          {/* Shops */}
          <StatTile
            label="Shops"
            icon={<Store className="h-3.5 w-3.5" />}
            iconClass="text-cyan-500"
            value={counts ? <>{counts.shops}</> : <span className="text-sm text-muted-foreground">…</span>}
            sub={counts ? `across ${counts.malls} mall${counts.malls !== 1 ? "s" : ""}` : undefined}
          />

          {/* Malls */}
          <StatTile
            label="Malls"
            icon={<MapPin className="h-3.5 w-3.5" />}
            iconClass="text-primary"
            value={counts ? <>{counts.malls}</> : <span className="text-sm text-muted-foreground">…</span>}
          />

          {/* Staged items */}
          <StatTile
            label="Staged Items"
            icon={<Database className="h-3.5 w-3.5" />}
            iconClass="text-violet-500"
            value={
              !backendOk ? (
                <span className="text-xs italic text-muted-foreground">Not tracked yet</span>
              ) : batchesLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <>{totalStaged}</>
              )
            }
            sub={
              backendOk && !batchesLoading
                ? `across ${batches.length} batch${batches.length !== 1 ? "es" : ""}`
                : undefined
            }
          />

          {/* Pending review */}
          <StatTile
            label="Pending Review"
            icon={<AlertCircle className="h-3.5 w-3.5" />}
            iconClass="text-amber-500"
            value={
              !backendOk ? (
                <span className="text-xs italic text-muted-foreground">Not tracked yet</span>
              ) : batchesLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <span className={pendingBatch > 0 ? "text-amber-600" : ""}>{pendingBatch}</span>
              )
            }
            sub={
              backendOk && !batchesLoading && pendingBatch > 0 ? (
                <button
                  onClick={() => onSwitchTab("research")}
                  className="text-primary hover:underline"
                >
                  Review in Research Batches →
                </button>
              ) : undefined
            }
          />
        </div>
      </section>

      {/* ── Section 2: Launch Readiness + Review Queue ───────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">

        {/* Launch readiness */}
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Launch Readiness Signal
          </h3>
          <Card className={cn("border-2", readiness.borderClass, readiness.bgClass)}>
            <CardContent className="pt-5 pb-5">
              <div className="flex items-start gap-3">
                <div className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                  readiness.iconClass,
                )}>
                  <TrendingUp className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <p className={cn("text-base font-semibold", readiness.textClass)}>
                    {readiness.label}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {readiness.description}
                  </p>

                  {/* Tier ladder */}
                  <div className="mt-3 space-y-1.5">
                    {[
                      { label: "Weak",        range: "< 250",     dot: "bg-red-400"     },
                      { label: "Improving",   range: "250 – 499", dot: "bg-amber-400"   },
                      { label: "Pilot ready", range: "500 – 999", dot: "bg-cyan-400"    },
                      { label: "Strong",      range: "1 000+",    dot: "bg-emerald-400" },
                    ].map((tier) => (
                      <div key={tier.label} className="flex items-center gap-2 text-xs">
                        <span className={cn("h-2 w-2 rounded-full shrink-0", tier.dot)} />
                        <span className="flex-1 text-muted-foreground">{tier.label}</span>
                        <span className="text-muted-foreground font-mono">{tier.range}</span>
                      </div>
                    ))}
                  </div>

                  <p className="mt-3 text-xs font-medium">
                    Total coverage:{" "}
                    <span className="font-bold">{totalCoverage}</span>
                    <span className="font-normal text-muted-foreground">
                      {" "}({liveProducts ?? "?"} live +{" "}
                      {backendOk ? totalStaged : "?"} staged)
                    </span>
                  </p>
                  <p className="mt-1 text-[10px] italic text-muted-foreground">
                    Heuristic only — not a guarantee of search quality.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Review queue */}
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Review Queue
          </h3>
          <Card className="h-full">
            <CardContent className="pt-5 pb-5 space-y-4">
              {!backendOk ? (
                <div className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
                  Configure <code>VITE_GOOGLE_BACKEND_URL</code> to track review queue.
                </div>
              ) : batchesLoading || findingsLoading ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  {/* Batch item summary */}
                  <div>
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Research Batch Items
                    </p>
                    {batchesError ? (
                      <p className="text-xs text-destructive">{batchesError}</p>
                    ) : (
                      <div className="space-y-2">
                        {[
                          { label: "Pending review", value: pendingBatch,   dot: "bg-amber-400",  text: pendingBatch > 0 ? "text-amber-700 font-semibold" : "" },
                          { label: "Reviewed",       value: totalReviewed,  dot: "bg-cyan-400",   text: "" },
                          { label: "Total staged",   value: totalStaged,    dot: "bg-primary/60", text: "font-semibold" },
                        ].map((row) => (
                          <div key={row.label} className="flex items-center gap-2.5 text-xs">
                            <span className={cn("h-2 w-2 shrink-0 rounded-full", row.dot)} />
                            <span className="flex-1 text-muted-foreground">{row.label}</span>
                            <span className={cn("tabular-nums", row.text)}>{row.value}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Mall Data Findings summary (if any) */}
                  {findings.length > 0 && (
                    <div>
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Mall Data Findings
                      </p>
                      {findingsError ? (
                        <p className="text-xs text-destructive">{findingsError}</p>
                      ) : (
                        <div className="space-y-2">
                          {(["pending", "approved", "rejected", "needs_more_info"] as const).map((st) => {
                            const n = byFindingStatus(st);
                            if (n === 0) return null;
                            const cfg = {
                              pending:         { dot: "bg-amber-400",   label: "Pending",             text: "text-amber-700" },
                              approved:        { dot: "bg-emerald-400", label: "Approved (staged)",   text: "text-emerald-700" },
                              rejected:        { dot: "bg-red-400",     label: "Rejected",            text: "text-red-600" },
                              needs_more_info: { dot: "bg-blue-400",    label: "Needs verification",  text: "text-blue-700" },
                            }[st];
                            return (
                              <div key={st} className="flex items-center gap-2.5 text-xs">
                                <span className={cn("h-2 w-2 shrink-0 rounded-full", cfg.dot)} />
                                <span className="flex-1 text-muted-foreground">{cfg.label}</span>
                                <span className={cn("tabular-nums font-semibold", cfg.text)}>{n}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Navigation links */}
                  <div className="border-t pt-3 space-y-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Jump to Review Workflow
                    </p>
                    <button
                      onClick={() => onSwitchTab("research")}
                      className="flex w-full items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary transition-colors hover:bg-primary/10"
                    >
                      <span className="font-medium">Open Research Batches</span>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                    </button>
                    <button
                      onClick={() => onSwitchTab("mall-data")}
                      className="flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs text-foreground/80 transition-colors hover:bg-muted"
                    >
                      <span>Open Mall Data Findings</span>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </section>
      </div>

      {/* ── Section 3: Ingestion Health + Source Quality Guide ───────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">

        {/* Ingestion health */}
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Ingestion Health
          </h3>
          <Card>
            <CardContent className="pt-4 pb-4">
              {!backendOk ? (
                <div className="py-3 text-center text-xs text-muted-foreground">
                  Backend not configured — ingestion health not available.
                </div>
              ) : batchesLoading ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : batches.length === 0 ? (
                <div className="py-4 text-center text-xs text-muted-foreground">
                  No ingestion runs yet. Create a research batch and ingest a source to see health stats.
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Top stat tiles */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {[
                      { label: "Research Batches",   value: batches.length,  color: "" },
                      { label: "Total Items Created", value: totalStaged,     color: "" },
                      { label: "Reviewed Items",      value: totalReviewed,   color: "" },
                      { label: "Pending Review",      value: pendingBatch,    color: pendingBatch > 0 ? "text-amber-600" : "" },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="rounded-lg border bg-card p-3">
                        <p className="text-muted-foreground">{label}</p>
                        <p className={cn("mt-1 text-xl font-bold leading-none", color)}>{value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Recent batches list */}
                  <div>
                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Recent Batches
                    </p>
                    <div className="space-y-1.5">
                      {batches.slice(0, 6).map((b) => (
                        <div
                          key={b.id}
                          className="flex items-center justify-between rounded border bg-muted/30 px-3 py-2 text-xs"
                        >
                          <span className="max-w-[180px] truncate font-medium">{b.title}</span>
                          <span className="ml-2 shrink-0 text-muted-foreground">
                            {b.item_count} item{b.item_count !== 1 ? "s" : ""}&nbsp;·&nbsp;
                            {b.reviewed_count} reviewed
                          </span>
                        </div>
                      ))}
                      {batches.length > 6 && (
                        <p className="text-center text-[10px] text-muted-foreground">
                          + {batches.length - 6} more batches
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-md border border-dashed p-2 text-[10px] text-muted-foreground">
                    Per-source detail (text length, candidate count, skipped reasons) is available in{" "}
                    <button
                      onClick={() => onSwitchTab("research")}
                      className="text-primary hover:underline"
                    >
                      Research Batches
                    </button>
                    {" "}after each ingestion run.
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* Source quality guide */}
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Source Quality Guide
          </h3>
          <Card>
            <CardContent className="pt-4 pb-4 space-y-2.5">
              {[
                { type: "official_website", note: "Retailer product page — strongest for price + product data" },
                { type: "retail_directory", note: "Official mall directory — strong for shop name/floor/unit" },
                { type: "manual_survey",    note: "Admin-entered data — strong, fully auditable" },
                { type: "public_flyer",     note: "PDF specials — medium strength, verify expiry date" },
                { type: "press_release",    note: "News / PR page — medium strength, verify data currency" },
                { type: "social_media",     note: "Facebook/Instagram — weak, treat as unverified hint" },
              ].map(({ type, note }) => (
                <div key={type} className="flex items-start gap-2.5">
                  <div className="pt-0.5">
                    <SourceQualityBadge type={type} />
                  </div>
                  <span className="text-xs leading-relaxed text-muted-foreground">{note}</span>
                </div>
              ))}

              <div className="mt-1 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-xs">
                <p className="font-semibold text-destructive">Blocked sources (existing blocklist):</p>
                <p className="mt-0.5 text-destructive/80">
                  Google Maps · Yelp · Apple Maps · TripAdvisor · Waze · general social crawlers.
                  Blocked at ingestion — Source Research Agent rejects these automatically.
                </p>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>

      {/* ── Section 4: Source Campaign Planner ──────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Source Campaign Planner
            </h3>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Plan which sources to ingest next. Add sources here, then open Research Batches to run ingestion.
            </p>
          </div>
          {backendOk && (
            <button
              onClick={() => setShowAddSource((s) => !s)}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
            >
              <Plus className="h-3 w-3" />
              {showAddSource ? "Cancel" : "Add Source"}
            </button>
          )}
        </div>

        {/* Add source inline form */}
        {showAddSource && backendOk && (
          <Card className="mb-4 border-primary/25">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Add New Research Source</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {/* Mall */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Mall *</label>
                  <Select value={newMallId} onValueChange={setNewMallId}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Select mall…" />
                    </SelectTrigger>
                    <SelectContent>
                      {malls.map((m) => (
                        <SelectItem key={String(m.id)} value={String(m.id)}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Source type */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Source type *</label>
                  <Select value={newType} onValueChange={(v) => setNewType(v as MallDataSourceType)}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="official_website">Official Retailer Website</SelectItem>
                      <SelectItem value="retail_directory">Mall / Retail Directory</SelectItem>
                      <SelectItem value="manual_survey">Admin Manual Entry</SelectItem>
                      <SelectItem value="public_flyer">Public Flyer / Catalogue</SelectItem>
                      <SelectItem value="press_release">Press Release / News</SelectItem>
                      <SelectItem value="social_media">Social Media (weak)</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Label */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Source name / label *</label>
                  <Input
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder="e.g. Game Sandton City website"
                    className="h-9 text-xs"
                  />
                </div>

                {/* URL */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Source URL (optional)</label>
                  <Input
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                    placeholder="https://…"
                    className="h-9 text-xs"
                  />
                </div>
              </div>

              {addError && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {addError}
                </div>
              )}

              <div className="flex items-center gap-3 pt-1">
                <Button
                  size="sm"
                  onClick={handleAddSource}
                  disabled={adding || !newMallId || !newLabel.trim()}
                >
                  {adding && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  {!adding && <Plus className="mr-1.5 h-3.5 w-3.5" />}
                  Add to Source List
                </Button>
                <p className="text-[10px] text-muted-foreground">
                  Saves to <code>mall_data_sources</code>. Use Research Batches to run ingestion.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Sources table */}
        <Card>
          <CardContent className="p-0">
            {!backendOk ? (
              <div className="p-5 text-center text-xs text-muted-foreground">
                Configure <code>VITE_GOOGLE_BACKEND_URL</code> to manage research sources.
              </div>
            ) : sourcesLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : sourcesError ? (
              <div className="p-4 text-xs text-destructive">{sourcesError}</div>
            ) : sources.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <Globe className="h-9 w-9 text-muted-foreground/20" />
                <div>
                  <p className="text-sm font-medium text-muted-foreground">No sources yet</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Add a source above to begin your data expansion campaign.
                  </p>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      {["Source", "Type / Quality", "Mall", "URL", "Status", "Action"].map((h) => (
                        <th key={h} className="px-3 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sources.map((src) => (
                      <tr key={src.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                        <td className="max-w-[160px] truncate px-3 py-2.5 font-medium">
                          {src.label}
                        </td>
                        <td className="px-3 py-2.5">
                          <SourceQualityBadge type={src.source_type} />
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">
                          {src.malls?.name ?? src.mall_id.slice(0, 8) + "…"}
                        </td>
                        <td className="max-w-[160px] px-3 py-2.5">
                          {src.source_url ? (
                            <a
                              href={src.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-primary hover:underline"
                            >
                              <ExternalLink className="h-3 w-3 shrink-0" />
                              <span className="max-w-[120px] truncate">{src.source_url}</span>
                            </a>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-medium",
                            src.is_active
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-muted text-muted-foreground",
                          )}>
                            {src.is_active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <button
                            onClick={() => onSwitchTab("research")}
                            className="flex items-center gap-1 text-primary hover:underline"
                          >
                            <ArrowRight className="h-3 w-3" />
                            Ingest →
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {backendOk && (
          <p className="mt-1.5 text-[10px] text-muted-foreground">
            To ingest a source:{" "}
            <button onClick={() => onSwitchTab("research")} className="text-primary hover:underline">
              Research Batches
            </button>
            {" "}→ select or create a batch → Source Ingestion Agent.
            Blocked sources (Google Maps, Yelp, etc.) are rejected automatically.
          </p>
        )}
      </section>

      {/* ── Section 5: Apply-to-Live safety notice ───────────────────────────── */}
      <section>
        <Card className="border-amber-200 bg-amber-50/40">
          <CardContent className="flex items-start gap-3 pt-4 pb-4">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="text-xs">
              <p className="font-semibold text-amber-800">
                Apply-to-live workflow: not yet enabled
              </p>
              <p className="mt-0.5 max-w-2xl text-amber-700">
                Approved staged items are held in the review queue — they do <strong>not</strong> auto-apply
                to the live <code>products</code> / <code>shops</code> tables. "Approved" means{" "}
                <em>staged and ready for live apply</em>. The dedicated apply workflow is planned for{" "}
                <strong>Sprint 12C / Sprint 15</strong>.
              </p>
              <ul className="mt-2 space-y-0.5 text-amber-700">
                <li>• Approved staged items → ready for live apply (held in queue)</li>
                <li>• Live products still require Apply Planner + admin confirmation</li>
                <li>• Until then: manually update products via the Price Trust tab</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ── Section 6: Expansion roadmap ─────────────────────────────────────── */}
      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Expansion Targets
        </h3>
        <div className="grid gap-4 sm:grid-cols-3">
          {([
            {
              phase: "Phase 1 — Foundation",
              color: "amber",
              items: [
                "250 staged products",
                "10 core retailers seeded",
                "1 pilot mall fully mapped",
                "Ingestion pipeline proven",
              ],
            },
            {
              phase: "Phase 2 — Growth",
              color: "cyan",
              items: [
                "500 staged products",
                "20 retailers across 3 malls",
                "Recurring review workflow",
                "Price trust metrics improving",
              ],
            },
            {
              phase: "Phase 3 — Scale",
              color: "emerald",
              items: [
                "1,000+ staged / live products",
                "Retailer verification partnerships",
                "Mall partner directory feeds",
                "Apply-to-live workflow active",
              ],
            },
          ] as const).map(({ phase, color, items }) => (
            <div
              key={phase}
              className={cn(
                "rounded-xl border p-4",
                color === "amber"   && "border-amber-200 bg-amber-50/40",
                color === "cyan"    && "border-cyan-200 bg-cyan-50/40",
                color === "emerald" && "border-emerald-200 bg-emerald-50/40",
              )}
            >
              <p className={cn(
                "mb-2.5 text-xs font-bold",
                color === "amber"   && "text-amber-700",
                color === "cyan"    && "text-cyan-700",
                color === "emerald" && "text-emerald-700",
              )}>
                {phase}
              </p>
              <ul className="space-y-1.5">
                {items.map((item) => (
                  <li key={item} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <CheckCircle2 className={cn(
                      "mt-0.5 h-3 w-3 shrink-0",
                      color === "amber"   && "text-amber-400",
                      color === "cyan"    && "text-cyan-400",
                      color === "emerald" && "text-emerald-400",
                    )} />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-1.5 text-[10px] italic text-muted-foreground">
          UI guidance only — not a launch commitment or timeline guarantee.
        </p>
      </section>

      {/* ── Section 7: Needs verification (product-level) ───────────────────── */}
      {counts && counts.products.needs_review > 0 && (
        <section>
          <Card className="border-orange-200 bg-orange-50/30">
            <CardContent className="flex items-start gap-3 pt-4 pb-4">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
              <div className="text-xs">
                <p className="font-semibold text-orange-800">
                  {counts.products.needs_review} live product{counts.products.needs_review !== 1 ? "s" : ""} need verification
                </p>
                <p className="mt-0.5 text-orange-700">
                  These products exist in the live table with <code>data_quality_status = needs_review</code>.
                  Review them in the{" "}
                  <button
                    onClick={() => onSwitchTab("price-trust")}
                    className="font-medium text-orange-800 hover:underline"
                  >
                    Price Trust tab
                  </button>
                  .
                </p>
              </div>
            </CardContent>
          </Card>
        </section>
      )}

    </div>
  );
}
