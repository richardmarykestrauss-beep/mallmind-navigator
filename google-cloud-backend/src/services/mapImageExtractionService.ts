/**
 * mapImageExtractionService.ts — Sprint 14B
 *
 * Provider abstraction for AI-assisted map image analysis.
 *
 * Interface:
 *   MapImageExtractionProvider — implement this to add a new vision provider.
 *
 * Providers available:
 *   "mock"         — deterministic test data keyed by floor_label (dev/staging)
 *   "gemini_vision" — (future) Gemini 2.0 Flash with image bytes
 *   "openai_vision" — (future) GPT-4o with base64 image
 *
 * Usage:
 *   const provider = getMapImageExtractionProvider("mock");
 *   const result   = await provider.extract({ asset_url, floor_label, extraction_mode });
 */

// ── Public types ──────────────────────────────────────────────────────────────

export type ExtractionMode = "anchors" | "corridors" | "full";

export interface DetectedAnchor {
  label:            string;
  anchor_type:      string;
  raw_text:         string;
  x_percent:        number | null;
  y_percent:        number | null;
  confidence_score: number;
  source_note:      string;
}

export interface DetectedCorridor {
  label:            string;
  x_percent:        number;
  y_percent:        number;
  confidence_score: number;
}

export interface ExtractionResult {
  floor_label:        string;
  detected_anchors:   DetectedAnchor[];
  detected_corridors: DetectedCorridor[];
  warnings:           string[];
  provider:           string;
}

export interface ExtractParams {
  asset_url:       string;
  floor_label:     string;
  extraction_mode: ExtractionMode;
  mall_id?:        string;
  notes?:          string;
}

/**
 * All extraction providers must implement this interface.
 * Providers are read-only: they return structured suggestions;
 * the calling route handler is responsible for persisting to Supabase.
 */
export interface MapImageExtractionProvider {
  readonly name: string;
  extract(params: ExtractParams): Promise<ExtractionResult>;
}

// ── Mock provider data ────────────────────────────────────────────────────────
//
// Pre-defined anchor layouts for known Mall of Africa floors.
// Coordinates are approximate % positions on a typical retail-mall floor plan:
//   parking at the four corners, entrances at mid-edges, shops in the interior.

interface MockAnchorDef {
  label:       string;
  anchor_type: string;
  x_percent:   number;
  y_percent:   number;
}

const MOCK_ANCHORS_BY_FLOOR: Record<string, MockAnchorDef[]> = {
  "level 3": [
    { label: "Game",                        anchor_type: "shop",     x_percent: 30, y_percent: 45 },
    { label: "Edgars",                      anchor_type: "shop",     x_percent: 68, y_percent: 44 },
    { label: "Truworths",                   anchor_type: "shop",     x_percent: 48, y_percent: 30 },
    { label: "Checkers",                    anchor_type: "shop",     x_percent: 55, y_percent: 65 },
    { label: "Woolworths",                  anchor_type: "shop",     x_percent: 38, y_percent: 56 },
    { label: "Entrance 13",                 anchor_type: "entrance", x_percent: 12, y_percent: 50 },
    { label: "Level 3 North East Parking",  anchor_type: "parking",  x_percent: 88, y_percent: 12 },
    { label: "Level 3 North West Parking",  anchor_type: "parking",  x_percent: 12, y_percent: 12 },
    { label: "Level 3 South East Parking",  anchor_type: "parking",  x_percent: 88, y_percent: 88 },
    { label: "Level 3 South West Parking",  anchor_type: "parking",  x_percent: 12, y_percent: 88 },
  ],
  "level 5": [
    { label: "Edgars",                      anchor_type: "shop",     x_percent: 70, y_percent: 44 },
    { label: "H&M",                         anchor_type: "shop",     x_percent: 50, y_percent: 34 },
    { label: "Zara",                        anchor_type: "shop",     x_percent: 56, y_percent: 50 },
    { label: "Woolworths",                  anchor_type: "shop",     x_percent: 38, y_percent: 56 },
    { label: "Town Square",                 anchor_type: "landmark", x_percent: 50, y_percent: 50 },
    { label: "Entrance 10",                 anchor_type: "entrance", x_percent: 88, y_percent: 50 },
    { label: "Entrance 11",                 anchor_type: "entrance", x_percent: 50, y_percent: 12 },
    { label: "Entrance 12",                 anchor_type: "entrance", x_percent: 12, y_percent: 50 },
    { label: "Entrance 22",                 anchor_type: "entrance", x_percent: 75, y_percent: 88 },
    { label: "Entrance 23",                 anchor_type: "entrance", x_percent: 50, y_percent: 88 },
    { label: "Entrance 24",                 anchor_type: "entrance", x_percent: 25, y_percent: 88 },
    { label: "Level 5 North East Parking",  anchor_type: "parking",  x_percent: 88, y_percent: 12 },
    { label: "Level 5 North West Parking",  anchor_type: "parking",  x_percent: 12, y_percent: 12 },
    { label: "Level 5 South East Parking",  anchor_type: "parking",  x_percent: 88, y_percent: 88 },
    { label: "Level 5 South West Parking",  anchor_type: "parking",  x_percent: 12, y_percent: 88 },
  ],
};

const MOCK_CORRIDORS_BY_FLOOR: Record<string, Array<{ label: string; x_percent: number; y_percent: number }>> = {
  "level 3": [
    { label: "L3 Corridor Node A", x_percent: 50, y_percent: 50 },
    { label: "L3 Corridor Node B", x_percent: 50, y_percent: 30 },
    { label: "L3 Corridor Node C", x_percent: 30, y_percent: 50 },
    { label: "L3 Corridor Node D", x_percent: 70, y_percent: 50 },
  ],
  "level 5": [
    { label: "L5 Corridor Node A", x_percent: 50, y_percent: 50 },
    { label: "L5 Corridor Node B", x_percent: 50, y_percent: 30 },
    { label: "L5 Corridor Node C", x_percent: 30, y_percent: 50 },
    { label: "L5 Corridor Node D", x_percent: 70, y_percent: 50 },
  ],
};

// ── Mock provider ─────────────────────────────────────────────────────────────

class MockMapExtractionProvider implements MapImageExtractionProvider {
  readonly name = "mock";

  async extract(params: ExtractParams): Promise<ExtractionResult> {
    const normalizedFloor = params.floor_label.toLowerCase().trim();

    // Partial-match: "Level 3 evacuation map" → "level 3"
    const anchorKey = Object.keys(MOCK_ANCHORS_BY_FLOOR).find(
      (k) => normalizedFloor.includes(k) || k.includes(normalizedFloor),
    );
    const corridorKey = Object.keys(MOCK_CORRIDORS_BY_FLOOR).find(
      (k) => normalizedFloor.includes(k) || k.includes(normalizedFloor),
    );

    const anchorDefs   = anchorKey   ? MOCK_ANCHORS_BY_FLOOR[anchorKey]   : [];
    const corridorDefs = corridorKey ? MOCK_CORRIDORS_BY_FLOOR[corridorKey] : [];

    const warnings: string[] = [];
    if (!anchorKey) {
      warnings.push(
        `No mock data found for floor "${params.floor_label}". ` +
        `Supported floors: ${Object.keys(MOCK_ANCHORS_BY_FLOOR).join(", ")}.`,
      );
    }

    const detected_anchors: DetectedAnchor[] =
      params.extraction_mode === "corridors"
        ? []
        : anchorDefs.map((a) => ({
            label:            a.label,
            anchor_type:      a.anchor_type,
            raw_text:         `${a.label} detected on ${params.floor_label}`,
            x_percent:        a.x_percent,
            y_percent:        a.y_percent,
            confidence_score: 0.75,
            source_note:
              `AI-suggested from uploaded map asset (mock provider, floor: ${params.floor_label})`,
          }));

    const detected_corridors: DetectedCorridor[] =
      params.extraction_mode === "anchors"
        ? []
        : corridorDefs.map((c) => ({
            label:            c.label,
            x_percent:        c.x_percent,
            y_percent:        c.y_percent,
            confidence_score: 0.65,
          }));

    return {
      floor_label:        params.floor_label,
      detected_anchors,
      detected_corridors,
      warnings,
      provider:           this.name,
    };
  }
}

// ── Provider registry ─────────────────────────────────────────────────────────

const PROVIDERS: Record<string, MapImageExtractionProvider> = {
  mock: new MockMapExtractionProvider(),
  // Future providers registered here:
  //   gemini_vision: new GeminiVisionProvider(),
  //   openai_vision: new OpenAIVisionProvider(),
};

/**
 * Return a registered extraction provider by name.
 * Throws if the provider is unknown — forces explicit provider selection at
 * the call site rather than silent fallback.
 */
export function getMapImageExtractionProvider(
  name = "mock",
): MapImageExtractionProvider {
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(
      `Unknown extraction provider: "${name}". Available: ${Object.keys(PROVIDERS).join(", ")}`,
    );
  }
  return provider;
}
