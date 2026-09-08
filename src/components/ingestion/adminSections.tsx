/**
 * Shared ingestion admin sections, used by BOTH the ingestion workbench
 * (/admin/data-ingestion) and the Data Command Center (/admin/data-command-center)
 * so there is a single implementation of each form/panel.
 *
 * Prototype — local persisted data. No live scraping, no dead buttons.
 */

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, PencilLine, Upload, Download, FileText, Camera } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { addOffer, addSourceSnapshot, commitOfferCsv, type OfferInput, type SnapshotInput } from "@/lib/ingestion/store";
import { parseCsv, templateCsvString, previewOffersCsv, type CsvPreview } from "@/lib/ingestion/csv";
import { PRICE_TRUST_LABELS, AVAILABILITY_LABELS } from "@/lib/ingestion/labels";
import { relativeAge } from "@/lib/ingestion/freshness";
import { isValidHttpUrl } from "@/lib/ingestion/validation";
import { SOURCE_TYPE_OPTIONS, sourceTypeLabel } from "@/components/ingestion/ingestionMeta";
import { TrustBadge, AvailabilityStatusBadge, FreshnessBadge, ToneBadge } from "@/components/ingestion/badges";
import type { IngestionDatabase, ProductOffer, SourceType } from "@/lib/ingestion/model";

export const inputCls = "w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60";

export function downloadCsv(kind: "offers" | "products" | "stores") {
  const blob = new Blob([templateCsvString(kind)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `mallmind-${kind}-template.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1"><span className="text-xs font-medium text-muted-foreground">{label}</span>{children}</label>;
}

// ── CSV import / staging ────────────────────────────────────────────────────────
export function CsvSection({ db, persist }: { db: IngestionDatabase; persist: (d: IngestionDatabase) => void }) {
  const [fileName, setFileName] = useState<string>("");
  const [preview, setPreview] = useState<CsvPreview<ProductOffer> | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [pasted, setPasted] = useState<string>("");

  const runPreview = (text: string, name: string) => {
    setFileName(name);
    setResult(null);
    setPreview(previewOffersCsv(parseCsv(text).rows, db, new Date().toISOString()));
  };
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    runPreview(await file.text(), file.name);
  };

  const approve = () => {
    if (!preview) return;
    const accepted = preview.results.filter((r) => r.status === "accepted").map((r) => r.entity!).filter(Boolean);
    const warned = preview.results.filter((r) => r.status === "warning" && r.entity).map((r) => ({ offer: r.entity!, reason: r.issues.map((i) => i.message).join("; ") }));
    const newProducts = preview.results.filter((r) => r.status !== "rejected" && r.newProduct).map((r) => r.newProduct!);
    const { db: next, run } = commitOfferCsv(db, accepted, warned, { filename: fileName || "pasted.csv", initiatedBy: "admin", totalRows: preview.totalRows, rejectedRows: preview.rejectedRows }, new Date().toISOString(), newProducts);
    persist(next);
    setResult(`Imported ${run.acceptedRows} accepted + ${run.warningRows} with warnings (staged for review). ${preview.rejectedRows} rejected, ${run.staleItemsDetected} stale. Run ${run.id.slice(0, 12)} recorded.`);
    setPreview(null);
    setPasted("");
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
        <CardHeader className="pb-2"><CardTitle className="text-sm">Import product offers (CSV) — rows stage first, never auto-approved</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-primary/40 bg-primary/5 px-4 py-6 text-sm">
            <Upload className="h-5 w-5 text-primary" />
            <span>{fileName || "Choose a CSV file to parse & preview"}</span>
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
          </label>
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">…or paste CSV text</span>
            <textarea className={cn(inputCls, "font-mono text-xs")} rows={3} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="retailer,mall,store,product_title,…" />
            <Button variant="glass" size="sm" disabled={!pasted.trim()} onClick={() => runPreview(pasted, "pasted.csv")}><FileText className="h-3.5 w-3.5" /> Preview pasted rows</Button>
          </div>

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
                  <CheckCircle2 className="h-3.5 w-3.5" /> Stage valid rows ({preview.acceptedRows + preview.warningRows})
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

// ── Manual offer entry ───────────────────────────────────────────────────────────
export function ManualOfferSection({ db, persist, onDone }: { db: IngestionDatabase; persist: (d: IngestionDatabase) => void; onDone?: () => void }) {
  const [f, setF] = useState<Partial<OfferInput>>({
    currency: "ZAR", channel: "in_store", sourceType: "manual_admin", priceTrustLabel: "manual_admin",
    availabilityScope: "availability_unknown", branchEvidencePresent: false, sourceObservedAt: new Date().toISOString().slice(0, 16),
  });
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: keyof OfferInput, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  const manualType = f.sourceType === "manual_admin" || f.sourceType === "manual_entry";
  const missing: string[] = [];
  if (!f.productId) missing.push("product");
  if (!f.retailerId) missing.push("retailer");
  if (!(Number(f.currentPrice) > 0)) missing.push("valid price");
  if (!isValidHttpUrl(f.sourceUrl) && !manualType) missing.push("source URL");
  if (!f.sourceObservedAt) missing.push("observed timestamp");
  if (!f.priceTrustLabel) missing.push("trust label");
  const branchWarn = f.availabilityScope === "branch_stock_confirmed" && !f.branchEvidencePresent;

  const submit = () => {
    if (missing.length) return;
    const input: OfferInput = {
      productId: f.productId!, retailerId: f.retailerId!, sellerName: f.sellerName ?? null, channel: f.channel!,
      currency: f.currency!, currentPrice: Number(f.currentPrice), previousPrice: f.previousPrice != null ? Number(f.previousPrice) : null,
      promotionLabel: f.promotionLabel ?? null, sourceUrl: f.sourceUrl ?? "", sourceType: f.sourceType!,
      sourceObservedAt: new Date(f.sourceObservedAt!).toISOString(), validUntil: f.validUntil ? new Date(f.validUntil).toISOString() : null,
      availabilityScope: f.availabilityScope!, priceTrustLabel: f.priceTrustLabel!, branchEvidencePresent: !!f.branchEvidencePresent,
      evidenceText: f.evidenceText ?? null, notes: f.notes ?? null,
    };
    const { db: next, issues } = addOffer(db, input, new Date().toISOString());
    persist(next);
    setMsg(`Offer staged for review${issues.length ? ` with ${issues.length} flag(s)` : ""}. Approve it in the Review queue to publish.`);
    if (onDone) setTimeout(onDone, 900);
  };

  return (
    <Card className="border-border/70 bg-surface/40">
      <CardHeader className="pb-2"><CardTitle className="text-sm">Add a single product offer (stages for review)</CardTitle></CardHeader>
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
          <Field label="Original price (R)"><input className={inputCls} type="number" value={f.previousPrice ?? ""} onChange={(e) => set("previousPrice", e.target.value)} /></Field>
          <Field label="Promo text"><input className={inputCls} value={f.promotionLabel ?? ""} onChange={(e) => set("promotionLabel", e.target.value)} placeholder="e.g. Weekend special" /></Field>
          <Field label={`Source URL${manualType ? "" : " *"}`}><input className={inputCls} value={f.sourceUrl ?? ""} onChange={(e) => set("sourceUrl", e.target.value)} placeholder="https://…" /></Field>
          <Field label="Source type"><select className={inputCls} value={f.sourceType} onChange={(e) => set("sourceType", e.target.value)}>{SOURCE_TYPE_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></Field>
          <Field label="Observed at *"><input className={inputCls} type="datetime-local" value={f.sourceObservedAt ?? ""} onChange={(e) => set("sourceObservedAt", e.target.value)} /></Field>
          <Field label="Expiry (promotions)"><input className={inputCls} type="datetime-local" value={f.validUntil ?? ""} onChange={(e) => set("validUntil", e.target.value)} /></Field>
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
        <Field label="Evidence text (cited price line)"><input className={inputCls} value={f.evidenceText ?? ""} onChange={(e) => set("evidenceText", e.target.value)} placeholder="e.g. Product page: R3,999 (was R4,499)" /></Field>
        <label className="block space-y-1"><span className="text-xs font-medium text-muted-foreground">Notes</span><textarea className={inputCls} rows={2} value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></label>

        {missing.length > 0 && <p className="text-xs text-amber-300">Staging is blocked until: {missing.join(", ")}.</p>}
        {msg && <div className="rounded-lg border border-secondary/40 bg-secondary/10 px-3 py-2 text-xs text-secondary">{msg}</div>}
        <Button variant="neon" size="sm" disabled={missing.length > 0} onClick={submit}><PencilLine className="h-3.5 w-3.5" /> Create offer (staged for review)</Button>
      </CardContent>
    </Card>
  );
}

// ── Source snapshots (captured evidence) ─────────────────────────────────────────
export function SnapshotsSection({ db, persist, nowMs, retailerName }: {
  db: IngestionDatabase; persist: (d: IngestionDatabase) => void; nowMs: number; retailerName: (id: string) => string;
}) {
  const [f, setF] = useState<Partial<SnapshotInput>>({ sourceType: "retailer_specials_page" });
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: keyof SnapshotInput, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  const missing: string[] = [];
  if (!isValidHttpUrl(f.sourceUrl)) missing.push("valid source URL");
  if (!f.evidenceText?.trim()) missing.push("evidence text");

  const submit = () => {
    if (missing.length) return;
    const { db: next, snapshot } = addSourceSnapshot(db, {
      sourceUrl: f.sourceUrl!, sourceType: (f.sourceType as SourceType) ?? "retailer_specials_page", evidenceText: f.evidenceText!.trim(),
      retailerId: f.retailerId || null, mallId: f.mallId || null, observedAt: f.observedAt || null, notes: f.notes?.trim() || null,
    }, new Date().toISOString());
    persist(next);
    setMsg(`Snapshot ${snapshot.id.slice(0, 14)} captured (staged). URL + timestamp + evidence preserved. No page was fetched.`);
    setF({ sourceType: "retailer_specials_page" });
  };

  return (
    <div className="space-y-4">
      <Card className="border-border/70 bg-surface/40">
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Camera className="h-4 w-4 text-primary" /> Capture source snapshot (paste evidence — no fetching)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Source URL *"><input className={inputCls} value={f.sourceUrl ?? ""} onChange={(e) => set("sourceUrl", e.target.value)} placeholder="https://…" /></Field>
            <Field label="Source type"><select className={inputCls} value={f.sourceType} onChange={(e) => set("sourceType", e.target.value)}>{SOURCE_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>
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
            <Field label="Observed at (optional)"><input className={inputCls} type="datetime-local" value={f.observedAt ?? ""} onChange={(e) => set("observedAt", e.target.value)} /></Field>
          </div>
          <Field label="Evidence text *"><textarea className={inputCls} rows={2} value={f.evidenceText ?? ""} onChange={(e) => set("evidenceText", e.target.value)} placeholder="Paste the price/availability line seen at source." /></Field>
          <Field label="Notes"><input className={inputCls} value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></Field>
          {missing.length > 0 && <p className="text-xs text-amber-300">Add: {missing.join(", ")}.</p>}
          {msg && <div className="rounded-lg border border-secondary/40 bg-secondary/10 px-3 py-2 text-xs text-secondary">{msg}</div>}
          <Button variant="neon" size="sm" disabled={missing.length > 0} onClick={submit}><Camera className="h-3.5 w-3.5" /> Capture snapshot</Button>
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-surface/40">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Stored snapshots ({db.snapshots.length})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border/60">
                <th className="px-4 py-2">Evidence / URL</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">Retailer</th>
                <th className="px-4 py-2">Captured</th><th className="px-4 py-2">Review</th><th className="px-4 py-2">Hash</th>
              </tr>
            </thead>
            <tbody>
              {db.snapshots.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No snapshots captured yet.</td></tr>}
              {db.snapshots.map((s) => (
                <tr key={s.id} className="border-b border-border/40 align-top">
                  <td className="px-4 py-2">
                    <p className="max-w-[280px] text-foreground">{s.evidenceExcerpt}</p>
                    <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="block max-w-[240px] truncate text-[11px] text-primary underline">{s.sourceUrl}</a>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{sourceTypeLabel(s.sourceType)}</td>
                  <td className="px-4 py-2 text-xs">{s.retailerId ? retailerName(s.retailerId) : "—"}</td>
                  <td className="px-4 py-2 text-[11px] text-muted-foreground">{relativeAge(s.retrievedAt, nowMs)}</td>
                  <td className="px-4 py-2"><ToneBadge tone={s.reviewStatus === "approved" ? "verified" : s.reviewStatus === "rejected" ? "danger" : "warning"}>{s.reviewStatus ?? "staged"}</ToneBadge></td>
                  <td className="px-4 py-2 font-mono text-[10px] text-muted-foreground">{s.contentHash}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Evidence panel ──────────────────────────────────────────────────────────────
export function EvidenceDialog({ db, offer, onClose, nowMs, productName, retailerName }: {
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
                <span>Source type: {sourceTypeLabel(offer.sourceType)}</span>
                <span>Review: {offer.reviewStatus}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <TrustBadge label={offer.priceTrustLabel} />
                <AvailabilityStatusBadge status={offer.availabilityStatus} />
                <FreshnessBadge offer={offer} nowMs={nowMs} />
              </div>
              {offer.evidenceText && <p className="mt-2 rounded border border-border/50 bg-background/40 px-2 py-1 text-xs text-muted-foreground">“{offer.evidenceText}”</p>}
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
