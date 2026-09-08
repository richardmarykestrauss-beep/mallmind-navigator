/**
 * mapFactoryNodeTypeMapper.ts — Sprint 15.3
 *
 * Canonical node type mapper for Map Factory route graph generation.
 *
 * Inputs:  anchor_type (string from extraction) + label (string)
 * Output:  CanonicalNodeType — a value valid in mall_nodes.type
 *
 * Resolution order:
 *   1. Direct anchor_type lookup (most specific)
 *   2. Label keyword heuristics
 *   3. Known South African retail store names → shop
 *   4. Default fallback → entrance
 *
 * Valid types match the extended CHECK constraint in migration 020:
 *   shop | entrance | escalator | lift | toilet | food_court | parking |
 *   corridor | landmark | stairs | emergency_exit | info_desk
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type CanonicalNodeType =
  | "shop"
  | "entrance"
  | "escalator"
  | "lift"
  | "toilet"
  | "food_court"
  | "parking"
  | "corridor"
  | "landmark"
  | "stairs"
  | "emergency_exit"
  | "info_desk";

// ── Direct anchor_type → canonical type map ───────────────────────────────────

const ANCHOR_TYPE_MAP: Record<string, CanonicalNodeType> = {
  shop:           "shop",
  entrance:       "entrance",
  parking:        "parking",
  lift:           "lift",
  escalator:      "escalator",
  stairs:         "stairs",         // previously mapped to "entrance" — fixed
  toilet:         "toilet",
  corridor_node:  "corridor",       // previously mapped to "entrance" — fixed
  emergency_exit: "emergency_exit", // previously mapped to "entrance" — fixed
  landmark:       "landmark",       // previously mapped to "info_desk" — fixed
  info_desk:      "info_desk",
  food_court:     "food_court",
};

// ── Known SA retail store names (lower-case) → shop ──────────────────────────

const KNOWN_STORE_NAMES: string[] = [
  // Anchor stores
  "game", "edgars", "truworths", "checkers", "woolworths",
  // Fashion
  "h&m", "zara", "identity", "stuttafords", "hilton weiner",
  "queenspark", "mr price", "mrprice", "ackermans", "jet", "pep",
  "legit", "exact!", "exact",
  // Food & health
  "shoprite", "pick n pay", "food lovers", "dis-chem", "dischem",
  // Electronics & other
  "incredible connection", "istore", "cna",
  // Sport
  "sportscene", "total sports", "totalsports", "the fix",
  // Banks
  "capitec", "fnb", "absa", "standard bank", "nedbank",
  // Other retail
  "clicks",
];

// ── Label keyword heuristics ──────────────────────────────────────────────────

const LABEL_RULES: Array<{ pattern: RegExp; type: CanonicalNodeType }> = [
  { pattern: /entrance|entry|door\s*\d/i,           type: "entrance"       },
  { pattern: /parking|car\s?park/i,                  type: "parking"        },
  { pattern: /\blift\b/i,                            type: "lift"           },
  { pattern: /escalator/i,                           type: "escalator"      },
  { pattern: /stair(case|s)?/i,                      type: "stairs"         },
  { pattern: /toilet|bathroom|restroom|\bwc\b|loo/i, type: "toilet"         },
  { pattern: /corridor|node\s*[a-z]\b/i,             type: "corridor"       },
  { pattern: /town\s*square|food\s*court|piazza|square|atrium|plaza/i, type: "landmark" },
  { pattern: /info(rmation)?\s*(desk|point)|help\s*desk|concierge/i,   type: "info_desk" },
  { pattern: /emergency|fire\s*exit|evacuation/i,    type: "emergency_exit" },
];

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns a canonical mall_nodes.type for a given anchor.
 *
 * @param anchorType  The raw anchor_type string from extraction data.
 * @param label       The human-readable anchor label.
 */
export function canonicalNodeType(anchorType: string, label: string): CanonicalNodeType {
  // 1. Direct anchor_type lookup
  const byType = ANCHOR_TYPE_MAP[anchorType.toLowerCase().trim()];
  if (byType) return byType;

  // 2. Label keyword rules
  for (const rule of LABEL_RULES) {
    if (rule.pattern.test(label)) return rule.type;
  }

  // 3. Known store name check (case-insensitive full/prefix/suffix match)
  const lowerLabel = label.toLowerCase().trim();
  for (const store of KNOWN_STORE_NAMES) {
    if (
      lowerLabel === store ||
      lowerLabel.startsWith(store + " ") ||
      lowerLabel.endsWith(" " + store) ||
      lowerLabel.includes(store)
    ) {
      return "shop";
    }
  }

  // 4. Default fallback
  return "entrance";
}

/**
 * Derive node type purely from the label (no anchor_type available).
 * Convenience wrapper used in tests and edge cases.
 */
export function nodeTypeFromLabel(label: string): CanonicalNodeType {
  return canonicalNodeType("", label);
}
