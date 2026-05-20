/**
 * artificialFloorPlanGeneratorService.ts — Sprint 15
 *
 * Generates MallMind's proprietary artificial floor plan from a layout model.
 *
 * Philosophy:
 *  - Third-party map images are used ONLY as evidence for factual anchor extraction.
 *  - The customer-facing floor plan is MallMind's own original artwork — a simplified,
 *    schematic representation generated programmatically from the merged anchor data.
 *  - Output: a JSON layout descriptor + an SVG string.
 *
 * The generated SVG is a clean, simplified schematic:
 *  - Neutral grey background (mall boundary)
 *  - Colour-coded zones by anchor type
 *  - Labelled dots/rectangles for each anchor
 *  - No third-party map artwork
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LayoutAnchor {
  label:       string;
  anchor_type: string;
  x_percent:   number | null;
  y_percent:   number | null;
}

export interface FloorPlanLayout {
  width:     number;
  height:    number;
  corridors: Array<{ x: number; y: number; w: number; h: number }>;
  zones:     Array<{ id: string; label: string; x: number; y: number; w: number; h: number; color: string }>;
  nodes:     Array<{ id: string; label: string; x: number; y: number; type: string }>;
}

export interface GeneratedFloorPlan {
  ok:           boolean;
  layout:       FloorPlanLayout | null;
  svgOutput:    string;
  floorPlanId?: string;
  error?:       string;
}

// ── Colour palette per anchor type ───────────────────────────────────────────

const ANCHOR_COLORS: Record<string, string> = {
  shop:           "#3B82F6",   // blue
  entrance:       "#10B981",   // emerald
  parking:        "#6B7280",   // slate
  lift:           "#F59E0B",   // amber
  escalator:      "#F59E0B",
  stairs:         "#F97316",   // orange
  toilet:         "#8B5CF6",   // violet
  corridor_node:  "#D1D5DB",   // light grey
  emergency_exit: "#EF4444",   // red
  landmark:       "#EC4899",   // pink
  info_desk:      "#14B8A6",   // teal
};

const DEFAULT_COLOR = "#9CA3AF";

// ── SVG generation ────────────────────────────────────────────────────────────

function generateSvg(layout: FloorPlanLayout): string {
  const { width, height, nodes } = layout;

  const nodeEls = nodes.map((n) => {
    const color = ANCHOR_COLORS[n.type] ?? DEFAULT_COLOR;
    const cx = (n.x / 100) * width;
    const cy = (n.y / 100) * height;

    // Parking and corridor nodes are smaller/subtler
    if (n.type === "parking") {
      return `<rect x="${cx - 12}" y="${cy - 8}" width="24" height="16" rx="3" fill="${color}" opacity="0.6"/>`
           + `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="6" fill="#fff" font-family="sans-serif">${escSvg(n.label.replace(/Level \d+ /i, "").substring(0, 12))}</text>`;
    }
    if (n.type === "corridor_node") {
      return `<circle cx="${cx}" cy="${cy}" r="4" fill="${color}" opacity="0.4"/>`;
    }
    return `<circle cx="${cx}" cy="${cy}" r="8" fill="${color}" opacity="0.85"/>`
         + `<text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="7" fill="#374151" font-family="sans-serif" font-weight="500">${escSvg(n.label.substring(0, 18))}</text>`;
  });

  // Main corridors (simple cross pattern)
  const corridorEls = layout.corridors.map((c) =>
    `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" fill="#E5E7EB" rx="2"/>`
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <!-- MallMind Proprietary Floor Plan — generated artwork, not derived from third-party maps -->
  <rect width="${width}" height="${height}" fill="#F9FAFB" rx="8" stroke="#D1D5DB" stroke-width="2"/>
  ${corridorEls.join("\n  ")}
  ${nodeEls.join("\n  ")}
  <text x="${width / 2}" y="${height - 6}" text-anchor="middle" font-size="8" fill="#9CA3AF" font-family="sans-serif">MallMind — Schematic Floor Plan</text>
</svg>`;
}

function escSvg(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Layout builder from anchors ───────────────────────────────────────────────

function buildLayout(anchors: LayoutAnchor[]): FloorPlanLayout {
  const W = 800, H = 600;

  const nodes = anchors
    .filter((a) => a.x_percent != null && a.y_percent != null)
    .map((a, i) => ({
      id:    `node_${i}`,
      label: a.label,
      x:     a.x_percent!,
      y:     a.y_percent!,
      type:  a.anchor_type,
    }));

  // Simple cross-corridor layout centred on the plan
  const corridors = [
    { x: W * 0.45, y: 0,         w: W * 0.1,  h: H },        // vertical spine
    { x: 0,        y: H * 0.45,  w: W,         h: H * 0.1 }, // horizontal spine
  ];

  return { width: W, height: H, corridors, zones: [], nodes };
}

// ── Main generator ────────────────────────────────────────────────────────────

export async function generateFloorPlan(
  jobId:       string,
  mallId:      string,
  floorLabel:  string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase:    any,
): Promise<GeneratedFloorPlan> {
  try {
    // Load the layout model for this job + floor
    const { data: model, error: modelErr } = await supabase
      .from("map_factory_layout_models")
      .select("merged_anchors")
      .eq("job_id", jobId)
      .eq("floor_label", floorLabel)
      .maybeSingle();

    if (modelErr) throw new Error(modelErr.message);
    if (!model)   throw new Error(`No layout model found for job ${jobId}, floor "${floorLabel}"`);

    const anchors: LayoutAnchor[] = Array.isArray(model.merged_anchors) ? model.merged_anchors : [];
    const layout  = buildLayout(anchors);
    const svg     = generateSvg(layout);

    // Check for existing draft — bump version if present
    const { data: existing } = await supabase
      .from("map_factory_generated_floorplans")
      .select("id, version")
      .eq("job_id", jobId)
      .eq("floor_label", floorLabel)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const version = existing ? existing.version + 1 : 1;

    // Supersede old record if present
    if (existing) {
      await supabase
        .from("map_factory_generated_floorplans")
        .update({ status: "superseded" })
        .eq("id", existing.id);
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("map_factory_generated_floorplans")
      .insert({
        job_id:      jobId,
        mall_id:     mallId,
        floor_label: floorLabel,
        version,
        layout_json: layout,
        svg_output:  svg,
        status:      "draft",
      })
      .select("id")
      .single();

    if (insertErr) throw new Error(insertErr.message);

    return { ok: true, layout, svgOutput: svg, floorPlanId: inserted.id };

  } catch (err) {
    return { ok: false, layout: null, svgOutput: "", error: String(err) };
  }
}
