/**
 * artificialFloorPlanGeneratorService.ts — Sprint 18B.5B
 *
 * Generates MallMind's proprietary artificial floor plan from a layout model.
 *
 * Philosophy:
 *  - Third-party map images are used ONLY as evidence for factual anchor extraction.
 *  - The customer-facing floor plan is MallMind's own original artwork — a simplified,
 *    schematic representation generated programmatically from the merged anchor data.
 *  - Output: a JSON layout descriptor + an SVG string.
 *
 * The generated SVG is a premium dark schematic:
 *  - Dark navy background (mall boundary)
 *  - Colour-coded zones: retail bands, anchor/landmark zone, entrance chips
 *  - Four corridor bands: main promenade + vertical connector + 2 secondary branches
 *  - Node tiers: ENTRY chips (green), landmark markers (cyan), shop blocks (silent)
 *  - No third-party map artwork
 */

// ── Public interfaces ────────────────────────────────────────────────────────

export interface LayoutAnchor {
  label: string;
  anchor_type: string;
  x_percent: number | null;
  y_percent: number | null;
}

export interface FloorPlanLayout {
  width: number;
  height: number;
  corridors: Array<{ x: number; y: number; w: number; h: number }>;
  zones: Array<{
    id: string;
    label: string;
    x: number;
    y: number;
    w: number;
    h: number;
    color: string;
  }>;
  nodes: Array<{
    id: string;
    label: string;
    x: number;
    y: number;
    type: string;
  }>;
}

export interface GeneratedFloorPlan {
  ok: boolean;
  layout: FloorPlanLayout | null;
  svgOutput: string;
  floorPlanId?: string;
  error?: string;
}

// ── Dark colour palette ───────────────────────────────────────────────────────

const C = {
  bg:           '#08101A',
  deck:         '#0C1520',
  deckBorder:   '#1A2D40',
  corridor:     '#101E2E',
  corridorLine: '#1C3050',
  zoneRetail:   '#0F1A27',
  zoneBorder:   '#1A3050',
  zoneEntFill:  '#091D12',
  zoneEntBd:    '#10B981',
  zoneLandFill: '#0C1E30',
  zoneLandBd:   '#0EA5E9',
  shopBlock:    '#0D1825',
  shopBorder:   '#182C40',
  entText:      '#10B981',
  landText:     '#38BDF8',
  dimText:      '#1E3A55',
  cyan:         '#06B6D4',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Round to 1 decimal for clean SVG output */
function r(n: number): number {
  return Math.round(n * 10) / 10;
}

function escSvg(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Layout builder ────────────────────────────────────────────────────────────

function buildLayout(anchors: LayoutAnchor[]): FloorPlanLayout {
  const W = 800;
  const H = 600;

  const corridors: FloorPlanLayout['corridors'] = [
    { x: 0,        y: r(H * 0.44), w: W,        h: r(H * 0.12)  },
    { x: r(W * 0.44), y: 0,        w: r(W * 0.12), h: H         },
    { x: 0,        y: r(H * 0.20), w: W,        h: r(H * 0.055) },
    { x: 0,        y: r(H * 0.73), w: W,        h: r(H * 0.055) },
  ];

  const zones: FloorPlanLayout['zones'] = [];

  zones.push({
    id: 'zone_retail_top',
    label: 'Retail',
    x: 0,
    y: r(H * 0.20 + H * 0.055),
    w: W,
    h: r(H * 0.44 - (H * 0.20 + H * 0.055)),
    color: C.zoneRetail,
  });

  zones.push({
    id: 'zone_retail_bottom',
    label: 'Retail',
    x: 0,
    y: r(H * 0.44 + H * 0.12),
    w: W,
    h: r(H * 0.73 - (H * 0.44 + H * 0.12)),
    color: C.zoneRetail,
  });

  const hasLandmark = anchors.some(
    (a) => a.anchor_type === 'landmark' || a.anchor_type === 'info_desk'
  );
  if (hasLandmark) {
    zones.push({
      id: 'zone_landmark',
      label: 'Landmark',
      x: r(W * 0.35),
      y: r(H * 0.35),
      w: r(W * 0.30),
      h: r(H * 0.30),
      color: C.zoneLandFill,
    });
  }

  anchors
    .filter((a) => a.anchor_type === 'entrance' && a.x_percent != null && a.y_percent != null)
    .forEach((a, i) => {
      const cx = r(((a.x_percent as number) / 100) * W);
      const cy = r(((a.y_percent as number) / 100) * H);
      zones.push({
        id: `zone_entrance_${i}`,
        label: a.label,
        x: r(cx - 22),
        y: r(cy - 10),
        w: 44,
        h: 20,
        color: C.zoneEntFill,
      });
    });

  const nodes: FloorPlanLayout['nodes'] = anchors
    .filter((a) => a.x_percent != null && a.y_percent != null)
    .slice(0, 80)
    .map((a, i) => ({
      id: `node_${i}`,
      label: a.label,
      x: a.x_percent as number,
      y: a.y_percent as number,
      type: a.anchor_type,
    }));

  return { width: W, height: H, corridors, zones, nodes };
}

// ── SVG generation ────────────────────────────────────────────────────────────

function generateSvg(layout: FloorPlanLayout): string {
  const { width: W, height: H, corridors, zones, nodes } = layout;

  const zoneEls = zones.map((z) => {
    const isEntrance  = z.id.startsWith('zone_entrance');
    const isLandmark  = z.id === 'zone_landmark';
    const borderColor = isEntrance ? C.zoneEntBd : isLandmark ? C.zoneLandBd : C.zoneBorder;
    return (
      `<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" ` +
      `rx="3" fill="${z.color}" stroke="${borderColor}" stroke-width="${isEntrance ? 1.2 : 0.8}" opacity="0.9"/>`
    );
  });

  const corridorEls = corridors.map(
    (c) =>
      `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" fill="${C.corridor}" rx="1"/>` +
      `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="1" fill="${C.corridorLine}" opacity="0.6"/>` +
      `<rect x="${c.x}" y="${r(c.y + c.h - 1)}" width="${c.w}" height="1" fill="${C.corridorLine}" opacity="0.6"/>`
  );

  const mainH  = corridors[0];
  const mainV  = corridors[1];
  const mainHY = r(mainH.y + mainH.h / 2);
  const mainVX = r(mainV.x + mainV.w / 2);
  const guideEls = [
    `<line x1="0" y1="${mainHY}" x2="${W}" y2="${mainHY}" stroke="${C.cyan}" stroke-width="0.4" stroke-dasharray="6 4" opacity="0.25"/>`,
    `<line x1="${mainVX}" y1="0" x2="${mainVX}" y2="${H}" stroke="${C.cyan}" stroke-width="0.4" stroke-dasharray="6 4" opacity="0.25"/>`,
  ];

  const intersectEl = `<circle cx="${mainVX}" cy="${mainHY}" r="5" fill="none" stroke="${C.cyan}" stroke-width="0.8" opacity="0.35"/>`;

  const shopNodes     = nodes.filter((n) => n.type === 'shop');
  const entranceNodes = nodes.filter((n) => n.type === 'entrance');
  const landmarkNodes = nodes.filter(
    (n) => n.type === 'landmark' || n.type === 'info_desk'
  );
  const otherNodes = nodes.filter(
    (n) => !['shop', 'entrance', 'landmark', 'info_desk', 'corridor_node'].includes(n.type)
  );

  const shopEls = shopNodes.slice(0, 36).map((n) => {
    const cx = r((n.x / 100) * W);
    const cy = r((n.y / 100) * H);
    return (
      `<rect x="${r(cx - 13)}" y="${r(cy - 5)}" width="26" height="10" rx="2" ` +
      `fill="${C.shopBlock}" stroke="${C.shopBorder}" stroke-width="0.6" opacity="0.7"/>`
    );
  });

  const UTIL_COLORS: Record<string, string> = {
    toilet:         '#8B5CF6',
    lift:           '#F59E0B',
    escalator:      '#F59E0B',
    stairs:         '#F97316',
    parking:        '#6B7280',
    emergency_exit: '#EF4444',
  };
  const otherEls = otherNodes.map((n) => {
    const cx    = r((n.x / 100) * W);
    const cy    = r((n.y / 100) * H);
    const color = UTIL_COLORS[n.type] ?? '#9CA3AF';
    return `<circle cx="${cx}" cy="${cy}" r="5" fill="${color}" opacity="0.55"/>`;
  });

  const landmarkEls = landmarkNodes.map((n) => {
    const cx = r((n.x / 100) * W);
    const cy = r((n.y / 100) * H);
    return (
      `<circle cx="${cx}" cy="${cy}" r="9" fill="${C.zoneLandFill}" stroke="${C.zoneLandBd}" stroke-width="1.2" opacity="0.9"/>` +
      `<text x="${cx}" y="${r(cy + 3)}" text-anchor="middle" font-size="6" fill="${C.landText}" font-family="sans-serif" font-weight="600">${escSvg(n.label.substring(0, 8))}</text>` +
      `<text x="${cx}" y="${r(cy + 17)}" text-anchor="middle" font-size="7" fill="${C.landText}" font-family="sans-serif" opacity="0.75">${escSvg(n.label.substring(0, 14))}</text>`
    );
  });

  const entranceEls = entranceNodes.map((n) => {
    const cx = r((n.x / 100) * W);
    const cy = r((n.y / 100) * H);
    return (
      `<rect x="${r(cx - 20)}" y="${r(cy - 8)}" width="40" height="16" rx="8" ` +
      `fill="${C.zoneEntFill}" stroke="${C.zoneEntBd}" stroke-width="1.2"/>` +
      `<text x="${cx}" y="${r(cy + 4)}" text-anchor="middle" font-size="7" fill="${C.entText}" font-family="sans-serif" font-weight="700" letter-spacing="0.5">ENTRY</text>`
    );
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <!-- MallMind Proprietary Floor Plan — premium generated artwork, not derived from third-party maps -->
  <defs>
    <linearGradient id="deckGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#142035"/>
      <stop offset="100%" stop-color="${C.deck}"/>
    </linearGradient>
  </defs>
  <!-- Background -->
  <rect width="${W}" height="${H}" fill="${C.bg}" rx="6" stroke="${C.deckBorder}" stroke-width="1.5"/>
  <!-- Deck -->
  <rect x="8" y="6" width="${W - 16}" height="${H - 12}" fill="url(#deckGrad)" rx="4" stroke="${C.deckBorder}" stroke-width="0.8" opacity="0.9"/>
  <!-- Top highlight strip -->
  <rect x="8" y="6" width="${W - 16}" height="2" fill="#1E3A55" rx="1" opacity="0.6"/>
  <!-- Zones -->
  ${zoneEls.join('\n  ')}
  <!-- Corridors -->
  ${corridorEls.join('\n  ')}
  <!-- Guide lines -->
  ${guideEls.join('\n  ')}
  ${intersectEl}
  <!-- Shop blocks -->
  ${shopEls.join('\n  ')}
  <!-- Utility nodes -->
  ${otherEls.join('\n  ')}
  <!-- Landmark markers -->
  ${landmarkEls.join('\n  ')}
  <!-- Entrance chips -->
  ${entranceEls.join('\n  ')}
  <!-- Footer -->
  <text x="${r(W / 2)}" y="${H - 5}" text-anchor="middle" font-size="8" fill="${C.dimText}" font-family="sans-serif" letter-spacing="0.3">MallMind — Generated schematic floor plan</text>
</svg>`;
}

// ── Main generator ────────────────────────────────────────────────────────────

export async function generateFloorPlan(
  jobId: string,
  mallId: string,
  floorLabel: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<GeneratedFloorPlan> {
  try {
    const { data: model, error: modelErr } = await supabase
      .from('map_factory_layout_models')
      .select('merged_anchors')
      .eq('job_id', jobId)
      .eq('floor_label', floorLabel)
      .maybeSingle();

    if (modelErr) throw new Error(modelErr.message);
    if (!model)
      throw new Error(`No layout model found for job ${jobId}, floor "${floorLabel}"`);

    const anchors: LayoutAnchor[] = Array.isArray(model.merged_anchors)
      ? model.merged_anchors
      : [];

    const layout  = buildLayout(anchors);
    const svg     = generateSvg(layout);

    const { data: existing } = await supabase
      .from('map_factory_generated_floorplans')
      .select('id, version')
      .eq('job_id', jobId)
      .eq('floor_label', floorLabel)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    const version = existing ? existing.version + 1 : 1;

    if (existing) {
      await supabase
        .from('map_factory_generated_floorplans')
        .update({ status: 'superseded' })
        .eq('id', existing.id);
    }

    const { data: inserted, error: insertErr } = await supabase
      .from('map_factory_generated_floorplans')
      .insert({
        job_id:      jobId,
        mall_id:     mallId,
        floor_label: floorLabel,
        version,
        layout_json: layout,
        svg_output:  svg,
        status:      'draft',
      })
      .select('id')
      .single();

    if (insertErr) throw new Error(insertErr.message);

    return { ok: true, layout, svgOutput: svg, floorPlanId: inserted.id };
  } catch (err) {
    return { ok: false, layout: null, svgOutput: '', error: String(err) };
  }
}
