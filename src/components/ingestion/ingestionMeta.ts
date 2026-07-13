/**
 * Shared display metadata for the ingestion admin + Data Command Center.
 * Keeps source-type / source-status / run-type wording in one place so the two
 * control-plane surfaces never drift apart.
 */

import type { SourceType, SourceRegistryStatus, IngestionRunType, IngestionRunStatus } from "@/lib/ingestion/model";
import type { BadgeTone } from "@/lib/ingestion/labels";

/** Source types offered when registering a snapshot (RC1 order). */
export const SOURCE_TYPE_OPTIONS: { value: SourceType; label: string }[] = [
  { value: "retailer_product_page", label: "Retailer product page" },
  { value: "retailer_search_page", label: "Retailer search page" },
  { value: "retailer_specials_page", label: "Retailer specials page" },
  { value: "catalogue_pdf", label: "Catalogue PDF" },
  { value: "catalogue_image", label: "Catalogue image" },
  { value: "mall_directory", label: "Mall directory" },
  { value: "partner_feed", label: "Partner feed" },
  { value: "admin_csv", label: "Admin CSV" },
  { value: "manual_entry", label: "Manual entry" },
  { value: "user_submission", label: "User submission" },
  { value: "aggregator_reference", label: "Aggregator reference" },
];

export const SOURCE_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  SOURCE_TYPE_OPTIONS.map((o) => [o.value, o.label]),
);
export function sourceTypeLabel(t: SourceType | "csv_import"): string {
  return SOURCE_TYPE_LABEL[t] ?? String(t).replace(/_/g, " ");
}

/** Registry-status display metadata. */
export const SOURCE_STATUS_META: Record<SourceRegistryStatus, { label: string; tone: BadgeTone; description: string }> = {
  candidate: { label: "Candidate", tone: "info", description: "Registered but not yet reviewed for ingestion." },
  approved: { label: "Approved", tone: "verified", description: "Cleared as a source we may snapshot manually." },
  needs_review: { label: "Needs review", tone: "warning", description: "Requires a human decision before use." },
  blocked: { label: "Blocked", tone: "danger", description: "Do not ingest — login wall, ToS or robots restriction." },
  deprecated: { label: "Deprecated", tone: "muted", description: "No longer used." },
};
export const SOURCE_STATUS_OPTIONS: SourceRegistryStatus[] = ["candidate", "approved", "needs_review", "blocked", "deprecated"];

/** Run-type display metadata. */
export const RUN_TYPE_META: Record<IngestionRunType, { label: string; tone: BadgeTone }> = {
  manual_csv: { label: "Manual CSV", tone: "info" },
  manual_entry: { label: "Manual entry", tone: "info" },
  source_snapshot: { label: "Source snapshot", tone: "special" },
  future_agent_research: { label: "Agent research (reserved)", tone: "muted" },
};

/** Run-status display metadata. */
export const RUN_STATUS_META: Record<IngestionRunStatus, { label: string; tone: BadgeTone }> = {
  staged: { label: "Staged", tone: "warning" },
  started: { label: "Started", tone: "info" },
  validating: { label: "Validating", tone: "info" },
  completed: { label: "Completed", tone: "verified" },
  failed: { label: "Failed", tone: "danger" },
  needs_review: { label: "Needs review", tone: "warning" },
  cancelled: { label: "Cancelled", tone: "muted" },
};
