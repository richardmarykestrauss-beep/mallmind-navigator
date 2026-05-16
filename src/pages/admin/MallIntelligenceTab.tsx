/**
 * MallIntelligenceTab — Sprint 12C
 *
 * Admin tab for the Mall Intelligence Harvester pipeline.
 * Sections:
 *   1. Source Discovery (add seed URLs, list discovered sources)
 *   2. Map Assets (discovered floor map / directory assets)
 *   3. Staged Store Locations (extracted, pending admin review)
 *   4. Route Graph placeholder (future sprint)
 *
 * Safety: no live-table writes. All actions are staged only.
 */

import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import {
  discoverMallSources,
  scanMallWebsiteSource,
  extractMallMapStores,
  verifyMallStoreLocation,
  reviewStagedLocation,
  stageMallRouteNodes,
  getMallIntelligenceAssets,
  getMallStagedLocations,
  detectGeoDirectoryForSource,
  importGeoDirectoryStores,
  getMallRouteNodes,
  placeRouteNodeCoordinate,
  GeoDirectoryImportError,
  type MallSource,
  type MallMapAsset,
  type MallStagedStoreLocation,
  type MallSourceType,
  type MallStagedReviewStatus,
  type ExtractMapResult,
  type GeoDirectoryDetectResult,
  type GeoDirectoryImportResult,
  type GeoDirectorySampleStore,
  type MallRouteNode,
} from "@/lib/googleBackendClient";
import { cn } from "@/lib/utils";
import {
  Globe,
  Plus,
  RefreshCw,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Flag,
  ExternalLink,
  Search,
  Eye,
  Layers,
  FileText,
  Map,
  Activity,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Mall {
  id:   string;
  name: string;
}

interface MallIntelligenceTabProps {
  token?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const SCAN_STATUS_LABELS: Record<string, string> = {
  pending:  "Pending",
  scanning: "Scanning…",
  scanned:  "Scanned",
  failed:   "Failed",
  stale:    "Stale",
};

const REVIEW_STATUS_COLORS: Record<string, string> = {
  pending:  "bg-yellow-100 text-yellow-800",
  accepted: "bg-green-100  text-green-800",
  rejected: "bg-red-100    text-red-800",
  flagged:  "bg-orange-100 text-orange-800",
};

const SOURCE_TYPE_LABELS: Record<MallSourceType | string, string> = {
  official_website: "Official Website",
  floor_map:        "Floor Map",
  store_directory:  "Store Directory",
  tenant_list:      "Tenant List",
  social_media:     "Social Media",
  unknown:          "Unknown",
};

function ConfidenceBadge({ value }: { value: number }) {
  const pct   = Math.round(value * 100);
  const color = pct >= 75 ? "text-green-700" : pct >= 50 ? "text-yellow-700" : "text-red-700";
  return <span className={cn("text-[10px] font-medium tabular-nums", color)}>{pct}%</span>;
}

// ── Sub-component: Section wrapper ────────────────────────────────────────────

function Section({
  title,
  icon,
  children,
  action,
}: {
  title:     string;
  icon:      React.ReactNode;
  children:  React.ReactNode;
  action?:   React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">{icon}</span>
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ── Sub-component: Source row ─────────────────────────────────────────────────

function SourceRow({
  source,
  token,
  onScan,
  onExtract,
  onImportGeoDir,
}: {
  source:         MallSource;
  token:          string;
  onScan:         (s: MallSource) => void;
  onExtract:      (s: MallSource) => void;
  onImportGeoDir: (s: MallSource, pages: number, perPage: number) => void;
}) {
  const [expanded,        setExpanded]        = useState(false);
  const [geoDirLoading,   setGeoDirLoading]   = useState(false);
  const [geoDirPages,     setGeoDirPages]     = useState(1);
  const [geoDirPerPage,   setGeoDirPerPage]   = useState(25);
  const [geoDirDetected,  setGeoDirDetected]  = useState<GeoDirectoryDetectResult | null>(
    // Pre-populate from persisted DB fields if already detected
    source.geodir_detected
      ? {
          source_id:       source.id,
          detected:        true,
          api_url:         source.geodir_api_url ?? "",
          stores_endpoint: source.geodir_api_url ? `${source.geodir_api_url}/stores` : "",
          route_names:     [],
          warnings:        [],
        }
      : null,
  );

  const isStaleDays = source.last_scanned_at
    ? Math.floor((Date.now() - new Date(source.last_scanned_at).getTime()) / 86_400_000)
    : null;
  const isStale = isStaleDays !== null && isStaleDays > 30;

  async function handleDetect() {
    if (!token) return;
    setGeoDirLoading(true);
    try {
      const result = await detectGeoDirectoryForSource(source.id, token);
      setGeoDirDetected(result);
    } catch {
      setGeoDirDetected({
        source_id:       source.id,
        detected:        false,
        api_url:         "",
        stores_endpoint: "",
        route_names:     [],
        warnings:        ["Detection request failed"],
      });
    } finally {
      setGeoDirLoading(false);
    }
  }

  return (
    <div className="rounded border bg-background text-xs">
      <div className="flex items-center gap-2 px-3 py-2">
        <Globe className="h-3 w-3 shrink-0 text-muted-foreground" />
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 flex-1 truncate font-medium text-primary hover:underline"
        >
          {source.page_title ?? source.url}
        </a>
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px]">
          {SOURCE_TYPE_LABELS[source.source_type] ?? source.source_type}
        </span>
        <span className={cn(
          "shrink-0 rounded px-1.5 py-0.5 text-[10px]",
          source.scan_status === "scanned" ? "bg-green-100 text-green-800" :
          source.scan_status === "failed"  ? "bg-red-100   text-red-800"  :
          source.scan_status === "stale"   ? "bg-orange-100 text-orange-800" :
          "bg-muted text-muted-foreground",
        )}>
          {SCAN_STATUS_LABELS[source.scan_status] ?? source.scan_status}
        </span>
        {(geoDirDetected?.detected || source.geodir_detected) && (
          <span className="shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-800 font-medium">
            GeoDir ✓
          </span>
        )}
        <ConfidenceBadge value={source.confidence} />
        {isStale && (
          <span className="flex items-center gap-0.5 text-[10px] text-orange-600">
            <AlertTriangle className="h-2.5 w-2.5" />
            {isStaleDays}d
          </span>
        )}
        <button onClick={() => setExpanded((v) => !v)} className="ml-1 text-muted-foreground hover:text-foreground">
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
      </div>

      {expanded && (
        <div className="border-t px-3 pb-3 pt-2 space-y-2">
          <p className="text-[10px] text-muted-foreground break-all">{source.url}</p>
          {source.last_scanned_at && (
            <p className="text-[10px] text-muted-foreground">
              Last scanned: {new Date(source.last_scanned_at).toLocaleString("en-ZA")}
            </p>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-1.5 mt-1">
            <button
              onClick={() => onScan(source)}
              className="flex items-center gap-1 rounded border px-2 py-1 text-[10px] hover:bg-muted transition-colors"
            >
              <Activity className="h-3 w-3" /> Scan Website
            </button>
            <button
              onClick={() => onExtract(source)}
              className="flex items-center gap-1 rounded border px-2 py-1 text-[10px] hover:bg-muted transition-colors"
            >
              <Search className="h-3 w-3" /> Extract Stores
            </button>
            <button
              onClick={() => void handleDetect()}
              disabled={geoDirLoading}
              className="flex items-center gap-1 rounded border px-2 py-1 text-[10px] hover:bg-muted transition-colors disabled:opacity-50"
            >
              {geoDirLoading
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <Globe className="h-3 w-3" />}
              Detect GeoDirectory
            </button>
            {(geoDirDetected?.detected || source.geodir_detected) && (
              <>
                <button
                  onClick={() => onImportGeoDir(source, geoDirPages, geoDirPerPage)}
                  className="flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] text-blue-800 hover:bg-blue-100 transition-colors"
                >
                  <Plus className="h-3 w-3" /> Import GeoDirectory Stores
                </button>
                {/* Import controls */}
                <div className="flex items-center gap-1.5 ml-1">
                  <span className="text-[10px] text-muted-foreground">Pages:</span>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={geoDirPages}
                    onChange={(e) => setGeoDirPages(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                    className="w-10 rounded border bg-background px-1 py-0.5 text-[10px] text-center focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                  <span className="text-[10px] text-muted-foreground">Per:</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={geoDirPerPage}
                    onChange={(e) => setGeoDirPerPage(Math.max(1, Math.min(100, parseInt(e.target.value) || 25)))}
                    className="w-12 rounded border bg-background px-1 py-0.5 text-[10px] text-center focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </div>
              </>
            )}
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 rounded border px-2 py-1 text-[10px] hover:bg-muted transition-colors"
            >
              <ExternalLink className="h-3 w-3" /> Open URL
            </a>
          </div>

          {/* GeoDirectory import helper text */}
          {(geoDirDetected?.detected || source.geodir_detected) && (
            <p className="text-[10px] text-muted-foreground">
              Start small. Import more pages after the first test succeeds.
            </p>
          )}

          {/* GeoDirectory detection result */}
          {geoDirDetected && (
            <div className={cn(
              "rounded border p-2 text-[10px] space-y-0.5 mt-1",
              geoDirDetected.detected
                ? "border-blue-200 bg-blue-50"
                : "border-amber-200 bg-amber-50",
            )}>
              {geoDirDetected.detected ? (
                <>
                  <p className="font-semibold text-blue-800">✓ GeoDirectory API confirmed</p>
                  <p className="text-blue-700 font-mono break-all">{geoDirDetected.stores_endpoint}</p>
                  {geoDirDetected.route_names.length > 0 && (
                    <p className="text-blue-600">
                      Routes: {geoDirDetected.route_names.slice(0, 4).join(", ")}
                      {geoDirDetected.route_names.length > 4 ? ` +${geoDirDetected.route_names.length - 4} more` : ""}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-amber-800">
                  ✗ GeoDirectory API not detected
                  {geoDirDetected.warnings[0] ? ` — ${geoDirDetected.warnings[0]}` : ""}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-component: Asset row ──────────────────────────────────────────────────

function AssetRow({ asset }: { asset: MallMapAsset }) {
  const [preview, setPreview] = useState(false);

  const isImage = asset.asset_type === "image";
  const isPdf   = asset.asset_type === "pdf";

  return (
    <div className="rounded border bg-background text-xs space-y-1">
      <div className="flex items-center gap-2 px-3 py-2">
        <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
        <a
          href={asset.asset_url}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 flex-1 truncate text-primary hover:underline"
        >
          {asset.link_text ?? asset.asset_url.split("/").pop() ?? asset.asset_url}
        </a>
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">
          {asset.asset_type}
        </span>
        {asset.floor_label && (
          <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700">
            {asset.floor_label}
          </span>
        )}
        {(isImage || isPdf) && (
          <button
            onClick={() => setPreview((v) => !v)}
            className="ml-1 text-muted-foreground hover:text-foreground"
          >
            <Eye className="h-3 w-3" />
          </button>
        )}
      </div>
      {preview && isImage && (
        <div className="px-3 pb-2">
          <img
            src={asset.asset_url}
            alt={asset.floor_label ?? "Floor map"}
            className="max-h-64 rounded border object-contain"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        </div>
      )}
      {preview && isPdf && (
        <div className="px-3 pb-2">
          <a
            href={asset.asset_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-primary underline"
          >
            <FileText className="h-3.5 w-3.5" /> Open PDF floor map
          </a>
        </div>
      )}
    </div>
  );
}

// ── Sub-component: Staged location row ───────────────────────────────────────

function StagedLocationRow({
  loc,
  token,
  onReview,
  onVerify,
}: {
  loc:      MallStagedStoreLocation;
  token:    string;
  onReview: (id: string, status: MallStagedReviewStatus, notes?: string) => void;
  onVerify: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [notes,    setNotes]    = useState("");

  return (
    <div className="rounded border bg-background text-xs">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="min-w-0 flex-1 truncate font-medium">
          {loc.shop_name ?? "(no name)"}
        </span>
        {loc.unit_number && (
          <span className="shrink-0 font-mono text-[10px]">{loc.unit_number}</span>
        )}
        {loc.floor_label && (
          <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700">
            {loc.floor_label}
          </span>
        )}
        {loc.category && (
          <span className="shrink-0 text-[10px] text-muted-foreground">{loc.category}</span>
        )}
        <ConfidenceBadge value={loc.confidence} />
        {loc.google_places_verified && (
          <span className="shrink-0 rounded bg-green-100 px-1 py-0.5 text-[10px] text-green-800">✓ Places</span>
        )}
        <span className={cn(
          "shrink-0 rounded px-1.5 py-0.5 text-[10px]",
          REVIEW_STATUS_COLORS[loc.review_status] ?? "bg-muted text-muted-foreground",
        )}>
          {loc.review_status}
        </span>
        <button onClick={() => setExpanded((v) => !v)} className="ml-1 text-muted-foreground hover:text-foreground">
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
      </div>

      {expanded && (
        <div className="border-t px-3 pb-3 pt-2 space-y-2">
          {/* Provenance */}
          <div className="rounded bg-muted/30 p-2 text-[10px] space-y-0.5">
            <p><span className="text-muted-foreground">Method:</span> {loc.extraction_method}</p>
            {loc.source_url && (
              <p><span className="text-muted-foreground">Source:</span>{" "}
                <a href={loc.source_url} target="_blank" rel="noopener noreferrer"
                   className="text-primary hover:underline truncate">{loc.source_url}</a>
              </p>
            )}
            {loc.raw_evidence && (
              <p className="mt-1 italic text-muted-foreground">"{loc.raw_evidence.slice(0, 120)}"</p>
            )}
          </div>

          {/* Notes input */}
          <input
            type="text"
            placeholder="Admin notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded border bg-background px-2 py-1 text-[10px] focus:outline-none focus:ring-1 focus:ring-primary"
          />

          {/* Actions */}
          <div className="flex flex-wrap gap-1.5">
            {loc.review_status !== "accepted" && (
              <button
                onClick={() => onReview(loc.id, "accepted", notes || undefined)}
                className="flex items-center gap-1 rounded border border-green-200 bg-green-50 px-2 py-1 text-[10px] text-green-800 hover:bg-green-100"
              >
                <CheckCircle2 className="h-3 w-3" /> Accept
              </button>
            )}
            {loc.review_status !== "rejected" && (
              <button
                onClick={() => onReview(loc.id, "rejected", notes || undefined)}
                className="flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-1 text-[10px] text-red-800 hover:bg-red-100"
              >
                <XCircle className="h-3 w-3" /> Reject
              </button>
            )}
            {loc.review_status !== "flagged" && (
              <button
                onClick={() => onReview(loc.id, "flagged", notes || undefined)}
                className="flex items-center gap-1 rounded border border-orange-200 bg-orange-50 px-2 py-1 text-[10px] text-orange-800 hover:bg-orange-100"
              >
                <Flag className="h-3 w-3" /> Flag
              </button>
            )}
            {!loc.google_places_verified && (
              <button
                onClick={() => onVerify(loc.id)}
                className="flex items-center gap-1 rounded border px-2 py-1 text-[10px] hover:bg-muted transition-colors"
              >
                <Search className="h-3 w-3" /> Verify (Places)
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-component: Coordinate Placement Panel ─────────────────────────────────

function CoordinatePlacementPanel({
  token,
  mallId,
  assets,
  onSaved,
}: {
  token:    string;
  mallId:   string;
  assets:   MallMapAsset[];
  onSaved:  () => void;
}) {
  const [nodes,          setNodes]          = useState<MallRouteNode[]>([]);
  const [loadingNodes,   setLoadingNodes]   = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [selectedAssetId,setSelectedAssetId]= useState("");
  const [pendingCoord,   setPendingCoord]   = useState<{ x: number; y: number } | null>(null);
  const [saving,         setSaving]         = useState(false);
  const [saveResult,     setSaveResult]     = useState<string | null>(null);
  const [saveError,      setSaveError]      = useState<string | null>(null);

  // Reload route nodes whenever mallId or token changes
  useEffect(() => {
    if (!mallId || !token) return;
    setLoadingNodes(true);
    setNodes([]);
    setSelectedNodeId("");
    setSelectedAssetId("");
    setPendingCoord(null);
    setSaveResult(null);
    setSaveError(null);
    getMallRouteNodes(mallId, token)
      .then((r) => setNodes(r.items))
      .catch(() => setNodes([]))
      .finally(() => setLoadingNodes(false));
  }, [mallId, token]);

  const unplacedNodes = nodes.filter(
    (n) => n.x_percent == null || n.y_percent == null,
  );
  const selectedNode  = nodes.find((n) => n.id === selectedNodeId);

  // Image assets compatible with the selected node's floor
  const imageAssets = assets.filter(
    (a) =>
      a.asset_type === "image" &&
      (!selectedNode?.floor_label ||
        !a.floor_label ||
        a.floor_label === selectedNode.floor_label),
  );
  const selectedAsset = assets.find((a) => a.id === selectedAssetId);

  function handleImageClick(e: React.MouseEvent<HTMLImageElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = parseFloat(
      (((e.clientX - rect.left) / rect.width) * 100).toFixed(2),
    );
    const y = parseFloat(
      (((e.clientY - rect.top) / rect.height) * 100).toFixed(2),
    );
    setPendingCoord({ x, y });
    setSaveResult(null);
    setSaveError(null);
  }

  async function handleSave() {
    if (!selectedNodeId || !pendingCoord || !token) return;
    setSaving(true);
    setSaveResult(null);
    setSaveError(null);
    try {
      const result = await placeRouteNodeCoordinate(
        {
          route_node_id: selectedNodeId,
          x_percent:     pendingCoord.x,
          y_percent:     pendingCoord.y,
        },
        token,
      );
      const msg =
        `Saved ${selectedNode?.label ?? selectedNodeId}: ` +
        `x=${result.x_percent}%, y=${result.y_percent}%` +
        (result.location_updated ? "  ·  staged location updated" : "");
      setSaveResult(msg);
      // Update local node list so it moves out of unplaced
      setNodes((prev) =>
        prev.map((n) =>
          n.id === selectedNodeId
            ? { ...n, x_percent: result.x_percent, y_percent: result.y_percent }
            : n,
        ),
      );
      setPendingCoord(null);
      setSelectedNodeId("");
      onSaved();
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!mallId) {
    return (
      <p className="text-xs text-muted-foreground text-center py-6">
        Select a mall above to use the coordinate placement tool.
      </p>
    );
  }

  return (
    <div className="space-y-4">

      {/* ── Node / asset selectors ─────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 items-end">

        {/* Route node selector */}
        <div className="flex-1 min-w-52 space-y-1">
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
            Route Node (unplaced)
          </label>
          {loadingNodes ? (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading nodes…
            </p>
          ) : nodes.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No route nodes found for this mall.
              Run "Stage Route Nodes" in the Route Graph section first.
            </p>
          ) : unplacedNodes.length === 0 ? (
            <p className="text-xs text-green-700">
              ✓ All {nodes.length} route node(s) have coordinates placed.
            </p>
          ) : (
            <select
              value={selectedNodeId}
              onChange={(e) => {
                setSelectedNodeId(e.target.value);
                setSelectedAssetId("");
                setPendingCoord(null);
                setSaveResult(null);
                setSaveError(null);
              }}
              className="w-full rounded border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">
                — select ({unplacedNodes.length} of {nodes.length} unplaced) —
              </option>
              {unplacedNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                  {n.floor_label ? `  ·  ${n.floor_label}` : ""}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Map asset selector (only visible when a node is selected) */}
        {selectedNodeId && (
          <div className="flex-1 min-w-52 space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              Map Image
              {selectedNode?.floor_label
                ? ` — filtered to "${selectedNode.floor_label}"`
                : " (all floors)"}
            </label>
            {imageAssets.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No image assets found. Run "Scan Website" to discover floor map images.
              </p>
            ) : (
              <select
                value={selectedAssetId}
                onChange={(e) => {
                  setSelectedAssetId(e.target.value);
                  setPendingCoord(null);
                  setSaveResult(null);
                }}
                className="w-full rounded border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">— select map image —</option>
                {imageAssets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.floor_label ?? a.link_text ?? a.asset_url.split("/").pop()}
                    {a.page_width_px
                      ? `  (${a.page_width_px}×${a.page_height_px})`
                      : ""}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      {/* ── Selected node info ─────────────────────────────────────────── */}
      {selectedNode && (
        <div className="rounded bg-muted/30 px-3 py-2 text-[10px] space-y-0.5">
          <p className="font-medium">{selectedNode.label}</p>
          <div className="flex flex-wrap gap-3 text-muted-foreground">
            {selectedNode.floor_label && (
              <span>Floor: <b>{selectedNode.floor_label}</b></span>
            )}
            <span>
              Current coords:{" "}
              {selectedNode.x_percent != null
                ? <b className="text-foreground">x={selectedNode.x_percent}%, y={selectedNode.y_percent}%</b>
                : <span className="text-amber-600">not placed</span>}
            </span>
            <span>Type: {selectedNode.node_type}</span>
          </div>
        </div>
      )}

      {/* ── Clickable map image ────────────────────────────────────────── */}
      {selectedAsset && (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Map className="h-3 w-3" />
            Click on the map to place the node coordinate. The red dot marks your selection.
          </p>

          {/* Image + overlay pin wrapper */}
          <div className="relative inline-block overflow-hidden rounded border bg-muted/10 max-w-full">
            <img
              src={selectedAsset.asset_url}
              alt={selectedAsset.floor_label ?? "Floor map"}
              className="block cursor-crosshair select-none max-w-full"
              style={{ maxHeight: "500px", width: "auto" }}
              onClick={handleImageClick}
              draggable={false}
              onError={(e) => {
                (e.target as HTMLImageElement).style.opacity = "0.3";
              }}
            />
            {pendingCoord && (
              <div
                className="pointer-events-none absolute"
                style={{
                  left:      `${pendingCoord.x}%`,
                  top:       `${pendingCoord.y}%`,
                  transform: "translate(-50%, -50%)",
                }}
              >
                {/* Red dot */}
                <div className="h-4 w-4 rounded-full border-2 border-white bg-red-500 shadow-lg ring-1 ring-red-400" />
                {/* Coordinate label */}
                <span
                  className="absolute left-1/2 top-5 -translate-x-1/2 whitespace-nowrap rounded
                             bg-black/75 px-1.5 py-0.5 text-[9px] font-mono text-white"
                >
                  {pendingCoord.x}%, {pendingCoord.y}%
                </span>
              </div>
            )}
          </div>

          {/* Coordinate preview + save row */}
          {pendingCoord ? (
            <div className="flex items-center gap-3 rounded border border-blue-200 bg-blue-50 px-3 py-2">
              <span className="font-mono text-[10px] text-blue-800">
                x = {pendingCoord.x}% &nbsp;·&nbsp; y = {pendingCoord.y}%
              </span>
              <button
                onClick={() => void handleSave()}
                disabled={saving}
                className="flex items-center gap-1 rounded border border-green-200 bg-green-50 px-2.5
                           py-1 text-[10px] text-green-800 hover:bg-green-100 disabled:opacity-50 transition-colors"
              >
                {saving
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <CheckCircle2 className="h-3 w-3" />}
                Save Coordinate
              </button>
              <button
                onClick={() => setPendingCoord(null)}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground">
              No coordinate selected — click anywhere on the map above.
            </p>
          )}
        </div>
      )}

      {/* ── Result / error banners ─────────────────────────────────────── */}
      {saveResult && (
        <div className="rounded border border-green-200 bg-green-50 px-3 py-2 text-[10px] text-green-800">
          ✓ {saveResult}
        </div>
      )}
      {saveError && (
        <div className="flex items-start gap-1.5 rounded border border-red-200 bg-red-50 px-3 py-2 text-[10px] text-red-700">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          {saveError}
        </div>
      )}

      {/* ── All-placed summary ─────────────────────────────────────────── */}
      {nodes.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
            Placement status ({nodes.filter((n) => n.x_percent != null).length}/{nodes.length} placed)
          </p>
          <div className="space-y-0.5 max-h-32 overflow-auto">
            {nodes.map((n) => (
              <div key={n.id} className="flex items-center gap-2 text-[10px]">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full shrink-0",
                    n.x_percent != null ? "bg-green-500" : "bg-amber-400",
                  )}
                />
                <span className="truncate">{n.label}</span>
                {n.floor_label && (
                  <span className="text-muted-foreground shrink-0">{n.floor_label}</span>
                )}
                {n.x_percent != null ? (
                  <span className="ml-auto font-mono text-muted-foreground shrink-0">
                    {n.x_percent}%, {n.y_percent}%
                  </span>
                ) : (
                  <span className="ml-auto text-amber-600 shrink-0">unplaced</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MallIntelligenceTab({ token }: MallIntelligenceTabProps) {
  const [malls,             setMalls]             = useState<Mall[]>([]);
  const [selectedMallId,    setSelectedMallId]    = useState<string>("");
  const [seedUrl,           setSeedUrl]           = useState("https://www.menlynpark.co.za/mall-map/");
  const [sourceType,        setSourceType]        = useState<MallSourceType>("floor_map");
  const [sources,           setSources]           = useState<MallSource[]>([]);
  const [assets,            setAssets]            = useState<MallMapAsset[]>([]);
  const [stagedLocs,        setStagedLocs]        = useState<MallStagedStoreLocation[]>([]);
  const [statusFilter,      setStatusFilter]      = useState<string>("all");

  const [loading,             setLoading]             = useState(false);
  const [actionLoading,       setActionLoading]       = useState<string | null>(null);
  const [error,               setError]               = useState<string | null>(null);
  const [lastAction,          setLastAction]           = useState<string | null>(null);
  const [extractResult,       setExtractResult]       = useState<ExtractMapResult | null>(null);
  const [geoDirImportResult,  setGeoDirImportResult]  = useState<GeoDirectoryImportResult | null>(null);
  const [geoDirImportError,   setGeoDirImportError]   = useState<{
    httpStatus: number;
    error:      string;
    hint:       string;
    warnings:   string[];
  } | null>(null);

  // ── Load malls ──────────────────────────────────────────────────────────────

  useEffect(() => {
    supabase
      .from("malls")
      .select("id, name")
      .order("name")
      .then(({ data }) => {
        if (data) setMalls(data as Mall[]);
      });
  }, []);

  // ── Load assets + locations ─────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const mallId = selectedMallId || undefined;
      const [assetsResult, locsResult] = await Promise.all([
        getMallIntelligenceAssets(mallId, token),
        getMallStagedLocations(mallId, statusFilter !== "all" ? statusFilter : undefined, token),
      ]);
      setSources(assetsResult.sources);
      setAssets(assetsResult.assets);
      setStagedLocs(locsResult.items);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [token, selectedMallId, statusFilter]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // ── Actions ─────────────────────────────────────────────────────────────────

  async function handleDiscover() {
    if (!token || !seedUrl.trim()) return;
    setActionLoading("discover");
    setError(null);
    try {
      await discoverMallSources(
        {
          mall_id:     selectedMallId || undefined,
          seed_url:    seedUrl.trim(),
          source_type: sourceType,
        },
        token,
      );
      setLastAction(`Source discovered: ${seedUrl}`);
      await loadData();
    } catch (e) {
      setError(String(e));
    } finally {
      setActionLoading(null);
    }
  }

  async function handleScan(source: MallSource) {
    if (!token) return;
    setActionLoading(`scan-${source.id}`);
    setError(null);
    try {
      const result = await scanMallWebsiteSource(source.id, token);
      setLastAction(
        `Scan complete: ${result.assets_found} asset(s) found, status: ${result.scan_status}` +
        (result.error ? ` — error: ${result.error}` : ""),
      );
      await loadData();
    } catch (e) {
      setError(String(e));
    } finally {
      setActionLoading(null);
    }
  }

  async function handleExtract(source: MallSource) {
    if (!token) return;
    setActionLoading(`extract-${source.id}`);
    setError(null);
    setExtractResult(null);
    setLastAction(null);
    try {
      const result = await extractMallMapStores(source.id, token);
      setExtractResult(result);
      await loadData();
    } catch (e) {
      setError(String(e));
    } finally {
      setActionLoading(null);
    }
  }

  async function handleImportGeoDir(source: MallSource, pages: number, perPage: number) {
    if (!token) return;
    setActionLoading(`geodir-import-${source.id}`);
    setError(null);
    setGeoDirImportResult(null);
    setGeoDirImportError(null);
    setLastAction(null);
    try {
      const result = await importGeoDirectoryStores(source.id, token, {
        maxPages: pages,
        perPage,
      });
      setGeoDirImportResult(result);
      await loadData();
    } catch (e) {
      if (e instanceof GeoDirectoryImportError) {
        // Structured error — show in the result panel, not the generic error banner
        setGeoDirImportError({
          httpStatus: e.httpStatus,
          error:      e.message,
          hint:       e.hint,
          warnings:   e.warnings,
        });
      } else {
        setError(String(e));
      }
    } finally {
      setActionLoading(null);
    }
  }

  async function handleVerify(locationId: string) {
    if (!token) return;
    setActionLoading(`verify-${locationId}`);
    setError(null);
    try {
      const result = await verifyMallStoreLocation(locationId, token);
      setLastAction(
        result.method === "not_configured"
          ? "Google Places API not configured — set GOOGLE_PLACES_API_KEY"
          : `Verified: ${result.verified ? "✓ match" : "✗ no match"} (${result.method})`,
      );
      await loadData();
    } catch (e) {
      setError(String(e));
    } finally {
      setActionLoading(null);
    }
  }

  async function handleReview(
    locationId: string,
    status:     MallStagedReviewStatus,
    notes?:     string,
  ) {
    if (!token) return;
    setActionLoading(`review-${locationId}`);
    setError(null);
    try {
      await reviewStagedLocation(locationId, status, notes, token);
      setLastAction(`Location ${status}`);
      // Optimistic update
      setStagedLocs((prev) =>
        prev.map((l) => l.id === locationId ? { ...l, review_status: status } : l),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setActionLoading(null);
    }
  }

  async function handleStageRouteNodes() {
    if (!token || !selectedMallId) return;
    setActionLoading("route-nodes");
    setError(null);
    try {
      const result = await stageMallRouteNodes(selectedMallId, token);
      setLastAction(`Route nodes staged: ${result.nodes_staged}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setActionLoading(null);
    }
  }

  const anyLoading = loading || actionLoading !== null;

  // ── Stats ───────────────────────────────────────────────────────────────────
  const pendingCount   = stagedLocs.filter((l) => l.review_status === "pending").length;
  const acceptedCount  = stagedLocs.filter((l) => l.review_status === "accepted").length;
  const rejectedCount  = stagedLocs.filter((l) => l.review_status === "rejected").length;

  const displayedLocs  = statusFilter === "all"
    ? stagedLocs
    : stagedLocs.filter((l) => l.review_status === statusFilter);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Mall Intelligence Harvester</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Discover official mall sources → scan → extract store locations → review → stage route graph.
          </p>
          <p className="mt-1 text-[10px] font-medium text-orange-700 rounded bg-orange-50 inline-block px-2 py-0.5">
            ⚠ All data is staged only. No writes to live tables.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedMallId}
            onChange={(e) => setSelectedMallId(e.target.value)}
            className="rounded border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">All malls</option>
            {malls.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <button
            onClick={() => void loadData()}
            disabled={anyLoading}
            className="flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50 transition-colors"
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Refresh
          </button>
        </div>
      </div>

      {/* ── Error / success banner ─────────────────────────────────────────── */}
      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {lastAction && !error && (
        <div className="rounded border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
          ✓ {lastAction}
        </div>
      )}

      {/* ── Extraction result panel ────────────────────────────────────────── */}
      {extractResult && !error && (
        <div className={cn(
          "rounded border px-3 py-3 text-xs space-y-2",
          extractResult.total_found === 0
            ? "border-amber-200 bg-amber-50"
            : "border-green-200 bg-green-50",
        )}>
          {/* Header row */}
          <div className="flex items-center justify-between">
            <span className="font-semibold">
              {extractResult.total_found === 0
                ? "⚠ No stores extracted"
                : "✓ Extraction complete"}
            </span>
            <button
              onClick={() => setExtractResult(null)}
              className="text-[10px] text-muted-foreground hover:text-foreground"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>

          {/* Stats row */}
          <div className="flex flex-wrap gap-3 text-[10px]">
            <span><b>{extractResult.total_found}</b> store(s) found</span>
            <span><b>{extractResult.stores_staged}</b> staged to DB</span>
            {extractResult.strategies_tried.length > 0 && (
              <span>
                strategies:{" "}
                <b className="font-mono">{extractResult.strategies_tried.join(", ")}</b>
              </span>
            )}
          </div>

          {/* JS-rendering amber guidance */}
          {extractResult.total_found === 0 && (
            <p className="text-[10px] text-amber-800">
              No stores were extracted from the HTML. This source may require JavaScript
              rendering or visual map extraction (OCR).
            </p>
          )}

          {/* Warnings */}
          {extractResult.warnings.length > 0 && (
            <div className="space-y-0.5">
              {extractResult.warnings.map((w, i) => (
                <p key={i} className="flex items-start gap-1 text-[10px] text-amber-700">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  {w}
                </p>
              ))}
            </div>
          )}

          {/* Insert errors */}
          {extractResult.insert_errors && extractResult.insert_errors.length > 0 && (
            <div className="space-y-0.5">
              <p className="text-[10px] font-semibold text-red-700">
                Insert errors ({extractResult.insert_errors.length}):
              </p>
              {extractResult.insert_errors.slice(0, 5).map((e, i) => (
                <p key={i} className="font-mono text-[10px] text-red-600">{e}</p>
              ))}
              {extractResult.insert_errors.length > 5 && (
                <p className="text-[10px] text-muted-foreground">
                  …and {extractResult.insert_errors.length - 5} more
                </p>
              )}
            </div>
          )}

          {/* Extraction log (collapsible) */}
          {extractResult.extraction_log.length > 0 && (
            <details className="text-[10px]">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Extraction log ({extractResult.extraction_log.length} entries)
              </summary>
              <div className="mt-1 space-y-0.5 font-mono text-muted-foreground">
                {extractResult.extraction_log.map((l, i) => (
                  <p key={i}>{l}</p>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* ── GeoDirectory import result panel ──────────────────────────────── */}
      {geoDirImportResult && !error && (
        <div className={cn(
          "rounded border px-3 py-3 text-xs space-y-2",
          geoDirImportResult.records_found === 0
            ? "border-amber-200 bg-amber-50"
            : "border-blue-200 bg-blue-50",
        )}>
          {/* Header */}
          <div className="flex items-center justify-between">
            <span className="font-semibold text-blue-900">
              {geoDirImportResult.detected
                ? geoDirImportResult.records_found === 0
                  ? "⚠ GeoDirectory API detected — no records returned"
                  : `✓ GeoDirectory import complete`
                : "✗ GeoDirectory API not detected"}
            </span>
            <button
              onClick={() => setGeoDirImportResult(null)}
              className="text-[10px] text-muted-foreground hover:text-foreground"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>

          {/* Stats */}
          <div className="flex flex-wrap gap-3 text-[10px]">
            <span><b>{geoDirImportResult.records_found}</b> records fetched</span>
            <span><b>{geoDirImportResult.stores_staged}</b> newly staged</span>
            <span><b>{geoDirImportResult.stores_updated}</b> updated</span>
            <span><b>{geoDirImportResult.pages_fetched}</b> page(s)</span>
          </div>

          {/* API endpoint info */}
          {geoDirImportResult.stores_endpoint && (
            <p className="font-mono text-[10px] text-blue-700 break-all">
              {geoDirImportResult.stores_endpoint}
            </p>
          )}

          {/* Warnings */}
          {geoDirImportResult.warnings.length > 0 && (
            <div className="space-y-0.5">
              {geoDirImportResult.warnings.slice(0, 5).map((w, i) => (
                <p key={i} className="flex items-start gap-1 text-[10px] text-amber-700">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  {w}
                </p>
              ))}
              {geoDirImportResult.warnings.length > 5 && (
                <p className="text-[10px] text-muted-foreground">
                  …and {geoDirImportResult.warnings.length - 5} more
                </p>
              )}
            </div>
          )}

          {/* Insert errors */}
          {geoDirImportResult.insert_errors.length > 0 && (
            <div className="space-y-0.5">
              <p className="text-[10px] font-semibold text-red-700">
                Errors ({geoDirImportResult.insert_errors.length}):
              </p>
              {geoDirImportResult.insert_errors.slice(0, 4).map((e, i) => (
                <p key={i} className="font-mono text-[10px] text-red-600">{e}</p>
              ))}
            </div>
          )}

          {/* Sample stores */}
          {geoDirImportResult.sample_stores.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold text-blue-800">
                Sample stores (first {geoDirImportResult.sample_stores.length}):
              </p>
              {geoDirImportResult.sample_stores.map((s: GeoDirectorySampleStore, i) => (
                <div key={i} className="rounded border border-blue-100 bg-white px-2 py-1 text-[10px] space-y-0.5">
                  <p className="font-medium truncate">{s.shop_name}</p>
                  <div className="flex flex-wrap gap-2 text-muted-foreground">
                    {s.unit_number  && <span>Unit: <b>{s.unit_number}</b></span>}
                    {s.floor_label  && <span>Floor: <b>{s.floor_label}</b></span>}
                    {s.category     && <span>{s.category}</span>}
                    <span className="ml-auto"><ConfidenceBadge value={s.confidence} /></span>
                  </div>
                  {s.parking_hint   && <p className="text-muted-foreground">🅿 {s.parking_hint}</p>}
                  {s.entrance_hint  && <p className="text-muted-foreground">🚪 Entrance {s.entrance_hint}</p>}
                  {s.road_name      && <p className="text-muted-foreground">📍 {s.road_name}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── GeoDirectory import error panel ───────────────────────────────── */}
      {geoDirImportError && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-3 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-red-800">
              ✗ GeoDirectory import failed — HTTP {geoDirImportError.httpStatus}
            </span>
            <button
              onClick={() => setGeoDirImportError(null)}
              className="text-[10px] text-muted-foreground hover:text-foreground"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
          <p className="text-[10px] text-red-700">{geoDirImportError.error}</p>
          <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] text-amber-800">
            💡 {geoDirImportError.hint}
          </p>
          {geoDirImportError.warnings.length > 0 && (
            <div className="space-y-0.5">
              {geoDirImportError.warnings.slice(0, 5).map((w, i) => (
                <p key={i} className="flex items-start gap-1 text-[10px] text-red-600">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  {w}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Section 1: Source Discovery ───────────────────────────────────── */}
      <Section
        title="Source Discovery"
        icon={<Globe className="h-3.5 w-3.5" />}
        action={
          <span className="text-[10px] text-muted-foreground">{sources.length} source(s)</span>
        }
      >
        {/* Add seed URL form */}
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-48 space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              Seed URL
            </label>
            <input
              type="url"
              value={seedUrl}
              onChange={(e) => setSeedUrl(e.target.value)}
              placeholder="https://www.menlynpark.co.za/mall-map/"
              className="w-full rounded border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              Type
            </label>
            <select
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value as MallSourceType)}
              className="rounded border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="floor_map">Floor Map</option>
              <option value="official_website">Official Website</option>
              <option value="store_directory">Store Directory</option>
              <option value="tenant_list">Tenant List</option>
              <option value="unknown">Unknown</option>
            </select>
          </div>
          <button
            onClick={() => void handleDiscover()}
            disabled={anyLoading || !seedUrl.trim()}
            className="flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {actionLoading === "discover"
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <Plus className="h-3 w-3" />}
            Discover
          </button>
        </div>

        {/* Sources list */}
        {sources.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            No sources discovered yet. Add a seed URL above to get started.
          </p>
        ) : (
          <div className="space-y-1.5">
            {sources.map((s) => (
              <SourceRow
                key={s.id}
                source={s}
                token={token ?? ""}
                onScan={handleScan}
                onExtract={handleExtract}
                onImportGeoDir={handleImportGeoDir}
              />
            ))}
          </div>
        )}
      </Section>

      {/* ── Section 2: Map Assets ─────────────────────────────────────────── */}
      <Section
        title="Map Assets"
        icon={<Map className="h-3.5 w-3.5" />}
        action={
          <span className="text-[10px] text-muted-foreground">{assets.length} asset(s)</span>
        }
      >
        {assets.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            No floor map assets yet. Scan a website to discover images, PDFs, and directory links.
          </p>
        ) : (
          <div className="space-y-1.5">
            {assets.map((a) => (
              <AssetRow key={a.id} asset={a} />
            ))}
          </div>
        )}
      </Section>

      {/* ── Section 3: Staged Store Locations ────────────────────────────── */}
      <Section
        title="Staged Store Locations"
        icon={<Layers className="h-3.5 w-3.5" />}
        action={
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className="text-green-700">{acceptedCount} accepted</span>
            <span>·</span>
            <span className="text-yellow-700">{pendingCount} pending</span>
            <span>·</span>
            <span className="text-red-700">{rejectedCount} rejected</span>
          </div>
        }
      >
        {/* Filter bar */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {["all", "pending", "accepted", "rejected", "flagged"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "rounded px-2.5 py-1 text-[10px] font-medium transition-colors",
                statusFilter === s
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/70",
              )}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
              {s === "all" && ` (${stagedLocs.length})`}
              {s !== "all" && ` (${stagedLocs.filter((l) => l.review_status === s).length})`}
            </button>
          ))}
        </div>

        {displayedLocs.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            {stagedLocs.length === 0
              ? "No staged store locations yet. Run Extract Stores on a source to populate this list."
              : `No ${statusFilter} items.`}
          </p>
        ) : (
          <div className="space-y-1.5">
            {displayedLocs.map((loc) => (
              <StagedLocationRow
                key={loc.id}
                loc={loc}
                token={token ?? ""}
                onReview={handleReview}
                onVerify={handleVerify}
              />
            ))}
          </div>
        )}
      </Section>

      {/* ── Section 4: Coordinate Placement ──────────────────────────────── */}
      <Section
        title="Coordinate Placement"
        icon={<Map className="h-3.5 w-3.5" />}
        action={
          selectedMallId && acceptedCount > 0 ? (
            <button
              onClick={() => void handleStageRouteNodes()}
              disabled={anyLoading}
              className="flex items-center gap-1 rounded border px-2.5 py-1 text-[10px] hover:bg-muted disabled:opacity-50 transition-colors"
              title="Stage accepted locations as route nodes"
            >
              {actionLoading === "route-nodes"
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <Plus className="h-3 w-3" />}
              Stage Route Nodes
            </button>
          ) : undefined
        }
      >
        <CoordinatePlacementPanel
          token={token ?? ""}
          mallId={selectedMallId}
          assets={assets}
          onSaved={() => void loadData()}
        />
      </Section>

      {/* ── Section 5: Route Graph (future) ──────────────────────────────── */}
      <Section
        title="Route Graph (Sprint 13+)"
        icon={<Activity className="h-3.5 w-3.5" />}
      >
        <div className="rounded border-2 border-dashed border-muted-foreground/20 bg-muted/10 min-h-24 flex flex-col items-center justify-center gap-2 p-4 text-center">
          <Activity className="h-8 w-8 text-muted-foreground/20" />
          <p className="text-sm font-medium text-muted-foreground">
            Live route graph editor — Sprint 13
          </p>
          <p className="text-xs text-muted-foreground/70">
            Place coordinates above, then connect nodes into edges here.
          </p>
          {displayedLocs.some((l) => l.x_percent != null) && (
            <p className="text-[10px] text-muted-foreground">
              {displayedLocs.filter((l) => l.x_percent != null).length} store(s) have coordinates
            </p>
          )}
        </div>
      </Section>
    </div>
  );
}
