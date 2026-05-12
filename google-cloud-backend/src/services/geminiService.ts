import { GoogleGenAI, Type, Tool, FunctionDeclaration, FunctionCallingConfigMode } from "@google/genai";
import { recommendProducts } from "./productService.js";
import { buildRoute, buildRouteNoSession } from "./routingService.js";
import { getSupabaseClient } from "../lib/supabase.js";
import type { ScoredProduct, RouteStep } from "../lib/types.js";

// ── Route intent detection ────────────────────────────────────────────────────
// Deterministic check on the raw user message — does NOT call Gemini.
// When true, we guarantee build_route=true even if Gemini skips the tool call.

const ROUTE_INTENT_PATTERNS = [
  /\btake me to\b/i,
  /\bdirections?\s+to\b/i,
  /\broute\s+to\b/i,
  /\bnavigate\s+to\b/i,
  /\bshow me the way to\b/i,
  /\bhow do i get to\b/i,
];

function detectRouteIntent(message: string): boolean {
  return ROUTE_INTENT_PATTERNS.some((p) => p.test(message));
}

// ── SA store hours check ──────────────────────────────────────────────────────

async function checkStoreHours(mallId: string, shopName: string) {
  const supabase = getSupabaseClient();
  const { data: shops } = await supabase
    .from("shops")
    .select("id, name, floor, unit_number, opening_time, closing_time")
    .eq("mall_id", mallId)
    .ilike("name", `%${shopName}%`)
    .limit(3);

  if (!shops?.length) return { found: false, message: `No store named "${shopName}" found.` };

  const now = new Date();
  const saHour = (now.getUTCHours() + 2) % 24;
  const saMin = now.getUTCMinutes();
  const saMinutes = saHour * 60 + saMin;

  return {
    found: true,
    stores: shops.map((s) => {
      let isOpen: boolean | null = null;
      if (s.opening_time && s.closing_time) {
        const [oh, om] = s.opening_time.split(":").map(Number);
        const [ch, cm] = s.closing_time.split(":").map(Number);
        isOpen = saMinutes >= oh * 60 + om && saMinutes < ch * 60 + cm;
      }
      const hoursDisplay = s.opening_time && s.closing_time
        ? `${s.opening_time.slice(0, 5)} – ${s.closing_time.slice(0, 5)}`
        : "Hours not available";
      return {
        name: s.name,
        floor: s.floor,
        unit_number: s.unit_number,
        opening_hours: hoursDisplay,
        current_time_sa: `${String(saHour).padStart(2, "0")}:${String(saMin).padStart(2, "0")}`,
        is_open: isOpen,
      };
    }),
  };
}

async function saveShoppingIntent(sessionId: string, intent: string) {
  const supabase = getSupabaseClient();
  await supabase
    .from("shopping_sessions")
    .update({ shopping_intent: intent, last_seen_at: new Date().toISOString() })
    .eq("id", sessionId);
  return { saved: true, intent };
}

// ── Gemini tool definitions ───────────────────────────────────────────────────

const toolDeclarations: FunctionDeclaration[] = [
  {
    name: "recommend_products",
    description:
      "Search live mall stock for products. Returns ranked results with prices, store locations and discounts. ALWAYS call this first for product queries when inside a mall.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: "Product name or description" },
        budget: { type: Type.NUMBER, description: "Max price in ZAR (only if user stated a budget)" },
        category: { type: Type.STRING, description: "Optional: Electronics, Clothing, Appliances, etc." },
      },
      required: ["query"],
    },
  },
  {
    name: "check_store_hours",
    description: "Check if a specific store is open now and get its trading hours.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        shop_name: { type: Type.STRING, description: "Store name e.g. Game, Woolworths, Clicks" },
      },
      required: ["shop_name"],
    },
  },
  {
    name: "save_shopping_intent",
    description: "Save the user's shopping goal to their active session. Call once you understand what they're looking for.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        intent: { type: Type.STRING, description: "e.g. Looking for a TV under R5000 and Nike sneakers" },
      },
      required: ["intent"],
    },
  },
  {
    name: "build_route",
    description: "Build a step-by-step navigation route to selected stores. Call when the user wants to be guided to a store.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        shop_ids: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "Shop IDs from recommend_products results — ground floor first",
        },
        summary: { type: Type.STRING, description: "e.g. 2 stops · ~15 min walk" },
      },
      required: ["shop_ids"],
    },
  },
];

const tools: Tool[] = [{ functionDeclarations: toolDeclarations }];

// ── System prompt builder ─────────────────────────────────────────────────────

function buildSystemPrompt(ctx: {
  mall_name?: string | null;
  current_floor?: string | null;
  shopping_intent?: string | null;
  budget?: number | null;
}): string {
  const lines = [
    // ── Identity ──────────────────────────────────────────────────────────────
    "You are MallMind — a premium retail concierge for South African shopping malls.",
    "You are sharp, confident, and brief. Users are on their phone inside a busy mall.",
    "Speak like a knowledgeable friend who knows this mall, not like a generic chatbot.",
    "SA English only. No filler phrases. Get straight to the useful information.",
    "",
    // ── Current context ───────────────────────────────────────────────────────
    ctx.mall_name
      ? `You are right now inside **${ctx.mall_name}** with the user.`
      : "No mall selected yet — ask the user to choose a mall before answering product queries.",
    ctx.current_floor ? `User is on Floor **${ctx.current_floor}**.` : "",
    ctx.shopping_intent ? `User goal: "${ctx.shopping_intent}"` : "",
    "",
    // ── Tool rules ────────────────────────────────────────────────────────────
    "TOOL RULES (non-negotiable):",
    "1. Always call recommend_products FIRST for any product or price query.",
    "2. CRITICAL — Route intent: If the user says 'take me to', 'directions to', 'route to',",
    "   'navigate to', 'show me the way to', or 'how do I get to' — call build_route",
    "   IMMEDIATELY after recommend_products. No confirmation. No preamble. Just call it.",
    "   Build the route even if the shop is closed. Warn about closure in your message.",
    "   NEVER mention sessions or system state. Routing always works.",
    "3. Call save_shopping_intent once you know what the user wants.",
    "4. Use check_store_hours only when the user explicitly asks about hours.",
    "5. Never invent data. If a tool returns nothing, say so — do not make up products,",
    "   prices, floors, unit numbers, or stock levels.",
    "",
    // ── Trust language ────────────────────────────────────────────────────────
    "PRICE TRUST RULES — follow these exactly based on data_quality_status:",
    "- manually_verified → say 'verified at R...' or 'confirmed R...'. Speak confidently.",
    "  Note: data_source may show 'manual_seed' — this does NOT downgrade a verified price.",
    "  Always use data_quality_status, not data_source, to decide trust language.",
    "- live_feed → say 'currently listed at R...' or 'live-feed price of R...'.",
    "- demo / missing → say 'listed at around R...' or 'sample price — confirm in-store'.",
    "- stale → warn explicitly: 'price was R... but may have changed — check in-store'.",
    "- Prefer manually_verified products over demo products when both match.",
    "",
    // ── Response quality ──────────────────────────────────────────────────────
    "RESPONSE QUALITY:",
    "- Lead with the best pick. Name it, price it, say why it's best (verified + discount + budget fit).",
    "- Be specific about screen size, brand, key specs from the product name — do not invent specs.",
    "- Mention floor/unit number so the user knows exactly where to go.",
    "- If a shop is closed, warn clearly but still give directions and price info.",
    "- Do not claim 'in stock' unless the data explicitly shows it.",
    "- Do not write long paragraphs. Short, punchy, useful.",
    "- Always end with a clear next action: directions, price confirmation, or asking what else.",
    "",
    // ── Budget mode ───────────────────────────────────────────────────────────
    ctx.budget
      ? `BUDGET: R${ctx.budget.toLocaleString()} — flag anything over budget clearly. Lead with under-budget options.`
      : "",
  ];
  return lines.filter(Boolean).join("\n");
}

// ── Main assistant function ───────────────────────────────────────────────────

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantContext {
  mall_id?: string | null;
  mall_name?: string | null;
  session_id?: string | null;
  user_id?: string | null;
  current_floor?: string | null;
  shopping_intent?: string | null;
  budget?: number | null;
}

export interface AssistantResult {
  message: string;
  products: ScoredProduct[];
  route_steps: RouteStep[];
  route_id: string | null;
  build_route: boolean;
  route_shop_ids: string[];
  route_summary: string;
}


// ── Intent classifier ─────────────────────────────────────────────────────────
// Lightweight deterministic classification of the user message.
// Used to log context and could gate future branching without touching Gemini.

type AssistantIntent =
  | "route_request"
  | "price_compare"
  | "deal_hunting"
  | "budget_recommendation"
  | "shop_lookup"
  | "verification_question"
  | "follow_up"
  | "product_search";

function classifyAssistantIntent(message: string): AssistantIntent {
  const m = message.toLowerCase();
  if (detectRouteIntent(message)) return "route_request";
  if (/\b(cheap(est)?|deals?|discount|specials?|sale|off)\b/.test(m)) return "deal_hunting";
  if (/\bcompare\b|\bwhich is better\b|\bvs\.?\s|\bversus\b/.test(m)) return "price_compare";
  if (/\bunder\s*r?\d+|\bbudget\b|\bafford\b|\bspend\b/.test(m)) return "budget_recommendation";
  if (/\b(is|are).{0,20}open\b|\bhours\b|\btrading\b|\bclosing\b/.test(m)) return "shop_lookup";
  if (/\bverified\b|\bconfirm\b|\baccurate\b|\btrust\b|\breal price\b/.test(m)) return "verification_question";
  if (/^(yes|no|ok(ay)?|sure|that one|the first|go ahead|sounds good)\b/i.test(m)) return "follow_up";
  return "product_search";
}

// ── Product trust helpers ─────────────────────────────────────────────────────
// NOTE: always use data_quality_status to determine trust — not data_source.
// A product with data_source="manual_seed" but data_quality_status="manually_verified"
// must be treated as verified.

function hasVerifiedPrice(p: ScoredProduct): boolean {
  return p.data_quality_status === "manually_verified" || p.data_quality_status === "live_feed";
}

/** Short trust label for embedding in natural-language messages. */
function getTrustLabel(p: ScoredProduct): string {
  switch (p.data_quality_status) {
    case "manually_verified": return "verified";
    case "live_feed":          return "live-feed price";
    case "stale":              return "possibly outdated — confirm in-store";
    case "user_submitted":     return "user-submitted price";
    case "needs_review":       return "needs in-store confirmation";
    default:                   return "sample data — price may vary";
  }
}

/** "R3,499 (verified)" or "around R3,499 (sample data — price may vary)" */
function formatPrice(p: ScoredProduct): string {
  const label = getTrustLabel(p);
  const amount = `R${p.price.toLocaleString("en-ZA")}`;
  return hasVerifiedPrice(p) ? `${amount} (${label})` : `around ${amount} (${label})`;
}

/** One-liner: "Hisense 43\" FHD LED TV at Game for a verified R3,499" */
function buildBestPickLine(p: ScoredProduct): string {
  const trust = hasVerifiedPrice(p) ? "verified " : "";
  return `${p.name} at ${p.shop_name} for a ${trust}R${p.price.toLocaleString("en-ZA")}`;
}

/**
 * 1–3 short reason fragments explaining why this product is the best pick.
 * Returns a full sentence ending with a period.
 */
function buildRecommendationWhy(p: ScoredProduct, budget: number | null | undefined): string {
  const reasons: string[] = [];
  if (p.data_quality_status === "manually_verified") reasons.push("verified price");
  else if (p.data_quality_status === "live_feed") reasons.push("live-feed price");

  if (p.is_on_special && p.discount_pct != null) reasons.push(`${p.discount_pct}% off`);

  if (budget != null && p.price <= budget) {
    const saving = budget - p.price;
    if (saving > 0) reasons.push(`R${saving.toLocaleString("en-ZA")} under budget`);
  } else if (budget != null && p.price > budget) {
    reasons.push(`R${(p.price - budget).toLocaleString("en-ZA")} over budget`);
  }

  const location = p.unit_number
    ? `Floor ${p.floor ?? "G"}, unit ${p.unit_number}`
    : p.floor
      ? `Floor ${p.floor}`
      : null;
  if (location) reasons.push(`find it at ${location}`);

  if (!reasons.length) return `Available at ${p.shop_name}.`;
  return reasons.join(" · ") + ".";
}

// ── Route fallback step builder ───────────────────────────────────────────────
// Used when mall_nodes/mall_edges are empty for a given mall.
// Generates a minimal human-readable step list from the ScoredProduct data
// that is already in scope — no extra DB query needed.

function buildFallbackRouteSteps(
  products: ScoredProduct[],
  shopIds: string[]
): RouteStep[] {
  const steps: RouteStep[] = [];
  let stepNum = 1;

  steps.push({
    step: stepNum++,
    instruction: "Start at the main mall entrance.",
    node_id: "",
    node_name: "Main Entrance",
    floor: "G",
    distance_meters: 0,
    floor_change: false,
    cumulative_meters: 0,
  });

  let cumulative = 0;
  for (const shopId of shopIds) {
    const p = products.find((x) => x.shop_id === shopId);
    if (!p) continue;
    const unit = p.unit_number ? ` at unit ${p.unit_number}` : "";
    const floor = p.floor ?? "G";
    cumulative += 100;
    steps.push({
      step: stepNum++,
      instruction: `Go to ${p.shop_name}${unit} on Floor ${floor}.`,
      node_id: "",
      node_name: p.shop_name,
      floor,
      distance_meters: 100,
      floor_change: false,
      cumulative_meters: cumulative,
    });
  }

  return steps;
}

// ── Route apology detection + override ───────────────────────────────────────
// Gemini sometimes generates "I can't build a route — session not active" before
// our post-processing adds the route data.  We detect those phrases and replace
// the message with a deterministic confirmation built from product facts.

const ROUTE_APOLOGY_PATTERNS = [
  /can'?t build.{0,50}route/i,
  /cannot build.{0,50}route/i,
  /unable to build.{0,50}route/i,
  /session isn'?t active/i,
  /session is not active/i,
  /no active session/i,
  /unfortunately.{0,80}(route|session|directions)/i,
  /route.{0,50}unavailable/i,
  /build.{0,50}route.{0,50}session/i,
];

function isRouteApologyMessage(text: string): boolean {
  return ROUTE_APOLOGY_PATTERNS.some((p) => p.test(text));
}

function buildRouteConfirmationMessage(
  products: ScoredProduct[],
  routeSummary: string
): string {
  const top = products[0];
  if (!top) {
    return "Your route is ready — follow the steps on screen.";
  }

  const priceStr = hasVerifiedPrice(top)
    ? `verified at R${top.price.toLocaleString("en-ZA")}`
    : `around R${top.price.toLocaleString("en-ZA")} (sample data — confirm in-store)`;

  const closedWarning =
    top.is_open_now === false
      ? ` ⚠️ ${top.shop_name} appears to be closed right now — check trading hours before heading over.`
      : "";

  const summaryStr = routeSummary ? ` (${routeSummary})` : "";

  return (
    `Route to ${top.shop_name} is ready${summaryStr}. ` +
    `${top.name} is ${priceStr}.${closedWarning} ` +
    `Follow the steps on screen.`
  );
}

/**
 * Premium "Best pick" fallback used when Gemini returns blank/weak final text
 * but recommend_products returned results.  Deterministic — never hallucinates.
 */
function buildProductFallbackMessage(
  products: ScoredProduct[],
  budget?: number | null
): string {
  if (!products.length) {
    return "I couldn't find matching products for that request at this mall right now.";
  }

  const top = products[0];
  const bestPick = buildBestPickLine(top);
  const why = buildRecommendationWhy(top, budget);

  const parts: string[] = [`Best pick: ${bestPick}.`, why];

  // Discount callout
  if (top.is_on_special && top.discount_pct != null) {
    parts.push(`That's ${top.discount_pct}% off the original R${(top.original_price ?? top.price).toLocaleString("en-ZA")}.`);
  }

  // Runner-up options (up to 2)
  if (products.length > 1) {
    const others = products
      .slice(1, 3)
      .map((p) => `${p.name} at ${p.shop_name} — ${formatPrice(p)}`);
    parts.push(`Also available: ${others.join("; ")}.`);
  }

  // Closed shop warning
  if (top.is_open_now === false) {
    parts.push(`Note: ${top.shop_name} appears to be closed right now — check trading hours.`);
  }

  // Next action
  if (hasVerifiedPrice(top)) {
    parts.push(`Say "take me to ${top.shop_name}" for turn-by-turn directions.`);
  } else {
    parts.push("Confirm the price in-store — this is sample data.");
  }

  return parts.filter(Boolean).join(" ");
}

export async function runAssistant(
  messages: Message[],
  ctx: AssistantContext
): Promise<AssistantResult> {
  // Uses Application Default Credentials — no API key needed.
  // On Cloud Run the Compute Engine service account provides identity automatically.
  const ai = new GoogleGenAI({
    vertexai: true,
    project: process.env.GOOGLE_CLOUD_PROJECT ?? "mallmind",
    // Gemini models live in us-central1 regardless of where Cloud Run is deployed.
    location: process.env.VERTEX_AI_LOCATION ?? "us-central1",
  });

  const allProducts: ScoredProduct[] = [];
  let routeSteps: RouteStep[] = [];
  let routeId: string | null = null;
  let routeShopIds: string[] = [];
  let routeSummary = "";

  // Convert message history to Gemini Content format
  const history = messages.slice(0, -1).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const lastMessage = messages[messages.length - 1];

  // Classify intent (deterministic, no LLM) for logging and safety-net guards.
  const intent = lastMessage.role === "user"
    ? classifyAssistantIntent(lastMessage.content)
    : "follow_up";
  console.log(`[assistant] intent=${intent} mall=${ctx.mall_name ?? "none"}`);

  // Detect explicit route intent on the current user turn.
  // This is our safety net: if Gemini skips build_route despite instruction,
  // we still return build_route=true with correct shop IDs.
  const routeIntentDetected = intent === "route_request";

  // Base config shared by all turns (system prompt + tools, mode=AUTO by default).
  // Tool-result turns use this directly so Gemini can choose to call another tool
  // or give a final text answer.
  const baseConfig = {
    systemInstruction: buildSystemPrompt(ctx),
    tools,
  };

  const chat = ai.chats.create({
    model: "gemini-2.5-flash",
    history,
    config: baseConfig,
  });

  // Agentic loop — up to 8 turns to resolve tool calls.
  //
  // FIRST TURN: force mode=ANY so Gemini must call at least one tool.
  // Without this, Gemini 2.5 Flash intermittently skips recommend_products
  // and responds from its own reasoning ("Sorry, no TVs at this mall")
  // even when products exist in the database.
  //
  // SUBSEQUENT TURNS: no config override → falls back to chat-level baseConfig
  // (mode=AUTO) so Gemini can freely give a final text answer after tools return.
  let response = await chat.sendMessage({
    message: lastMessage.content,
    config: {
      ...baseConfig,
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode.ANY,
          allowedFunctionNames: ["recommend_products"],
        },
      },
    },
  });

  for (let turn = 0; turn < 8; turn++) {
    const fnCalls = response.functionCalls ?? [];

    if (fnCalls.length === 0) {
      // No more tool calls — return final text.
      // If Gemini returns products but no final text, still give the user
      // a useful deterministic answer instead of a blank apology.
      const finalText = response.text?.trim();

      // ── Route intent safety net ──────────────────────────────────────────
      // If the user explicitly asked for directions and Gemini found products
      // but never called build_route (e.g. asked for confirmation instead),
      // we forcibly build the route here.  This is deterministic — never
      // relies on LLM compliance with the prompt instruction.
      if (routeIntentDetected && allProducts.length > 0 && routeShopIds.length === 0) {
        // Deduplicate: top-scored product's shop first, then others
        const seenShops = new Set<string>();
        for (const p of allProducts) {
          if (!seenShops.has(p.shop_id)) seenShops.add(p.shop_id);
        }
        routeShopIds = [...seenShops];

        try {
          if (ctx.session_id) {
            // Persist the route and get full Dijkstra steps
            const r = await buildRoute(ctx.session_id, routeShopIds, ctx.user_id ?? null);
            routeSteps = r.steps.length > 0
              ? r.steps
              : buildFallbackRouteSteps(allProducts, routeShopIds);
            routeId = r.route_id;
            routeSummary = routeSummary ||
              `${r.stop_count} stop${r.stop_count !== 1 ? "s" : ""} · ~${r.estimated_minutes} min walk`;
          } else if (ctx.mall_id) {
            // No session — build from mall graph directly (not persisted)
            const r = await buildRouteNoSession(ctx.mall_id, routeShopIds);
            if (!r.fallback && r.steps.length > 0) {
              // Graph data exists — use Dijkstra steps
              routeSteps = r.steps;
              routeSummary = routeSummary ||
                `${r.stop_count} stop${r.stop_count !== 1 ? "s" : ""} · ~${r.estimated_minutes} min walk`;
            } else {
              // No graph data for this mall — synthesise steps from product info
              routeSteps = buildFallbackRouteSteps(allProducts, routeShopIds);
              routeSummary = routeSummary ||
                `${routeShopIds.length} stop${routeShopIds.length !== 1 ? "s" : ""}`;
            }
            routeId = null;
          }
        } catch (err) {
          // Route build failure is non-fatal — synthesise from product info
          console.error("[assistant] forced route build failed:", err);
          if (routeSteps.length === 0) {
            routeSteps = buildFallbackRouteSteps(allProducts, routeShopIds);
            routeSummary = routeSummary ||
              `${routeShopIds.length} stop${routeShopIds.length !== 1 ? "s" : ""}`;
          }
        }
      }

      // ── Message override ──────────────────────────────────────────────────
      // Gemini sometimes writes "can't build route — session not active" before
      // our post-processing adds the route data.  Replace apology messages with
      // a correct confirmation when we successfully have route steps to show.
      let message = finalText || buildProductFallbackMessage(allProducts, ctx.budget);
      if (
        routeIntentDetected &&
        routeShopIds.length > 0 &&
        routeSteps.length > 0 &&
        isRouteApologyMessage(message)
      ) {
        message = buildRouteConfirmationMessage(allProducts, routeSummary);
      }

      return {
        message,
        products: allProducts,
        route_steps: routeSteps,
        route_id: routeId,
        build_route: routeShopIds.length > 0,
        route_shop_ids: routeShopIds,
        route_summary: routeSummary,
      };
    }

    // Execute each tool call and collect results
    const functionResponses = [];

    for (const fn of fnCalls) {
      let toolResult: string;

      try {
        if (fn.name === "recommend_products") {
          const args = fn.args as { query: string; budget?: number; category?: string };
          if (ctx.mall_id) {
            const found = await recommendProducts({
              mall_id: ctx.mall_id,
              query: args.query,
              budget: args.budget ?? ctx.budget ?? null,
              category: args.category ?? null,
            });
            allProducts.push(...found);
            toolResult = found.length
              ? JSON.stringify({ found: true, count: found.length, results: found })
              : JSON.stringify({ found: false, message: `No products found for "${args.query}" at this mall.` });
          } else {
            toolResult = JSON.stringify({ found: false, message: "No mall selected. Ask the user to select a mall." });
          }
        } else if (fn.name === "check_store_hours") {
          const args = fn.args as { shop_name: string };
          const hoursResult = ctx.mall_id
            ? await checkStoreHours(ctx.mall_id, args.shop_name)
            : { found: false, message: "No mall selected." };
          toolResult = JSON.stringify(hoursResult);
        } else if (fn.name === "save_shopping_intent") {
          const args = fn.args as { intent: string };
          const saved = ctx.session_id
            ? await saveShoppingIntent(ctx.session_id, args.intent)
            : { saved: false };
          toolResult = JSON.stringify(saved);
        } else if (fn.name === "build_route") {
          const args = fn.args as { shop_ids: string[]; summary?: string };
          routeShopIds = args.shop_ids.map(String);
          routeSummary = args.summary ?? "";

          // Inner try so a DB failure falls back to product-derived steps
          // rather than leaving routeSteps empty and confusing the user.
          try {
            if (ctx.session_id && routeShopIds.length) {
              // ── Session path: full Dijkstra + persist ──────────────────────
              const r = await buildRoute(ctx.session_id, routeShopIds, ctx.user_id ?? null);
              routeSteps = r.steps.length > 0
                ? r.steps
                : buildFallbackRouteSteps(allProducts, routeShopIds);
              routeId = r.route_id;
              routeSummary = routeSummary ||
                `${r.stop_count} stop${r.stop_count !== 1 ? "s" : ""} · ~${r.estimated_minutes} min walk`;
              toolResult = JSON.stringify({ built: true, steps: routeSteps.length, estimated_minutes: r.estimated_minutes });
            } else if (ctx.mall_id && routeShopIds.length) {
              // ── No-session path: mall graph, not persisted ─────────────────
              const r = await buildRouteNoSession(ctx.mall_id, routeShopIds);
              if (!r.fallback && r.steps.length > 0) {
                routeSteps = r.steps;
                routeSummary = routeSummary ||
                  `${r.stop_count} stop${r.stop_count !== 1 ? "s" : ""} · ~${r.estimated_minutes} min walk`;
              } else {
                // No graph data — synthesise from product info already in scope
                routeSteps = buildFallbackRouteSteps(allProducts, routeShopIds);
                routeSummary = routeSummary ||
                  `${routeShopIds.length} stop${routeShopIds.length !== 1 ? "s" : ""}`;
              }
              routeId = null;
              toolResult = JSON.stringify({ built: true, fallback: r.fallback, steps: routeSteps.length });
            } else {
              // ── No session and no mall — synthesise if products available ──
              if (allProducts.length > 0) {
                routeSteps = buildFallbackRouteSteps(allProducts, routeShopIds);
                routeSummary = routeSummary ||
                  `${routeShopIds.length} stop${routeShopIds.length !== 1 ? "s" : ""}`;
                toolResult = JSON.stringify({ built: true, fallback: true, steps: routeSteps.length });
              } else {
                toolResult = JSON.stringify({ built: false, message: "No mall context available — cannot build route." });
              }
            }
          } catch (routeErr) {
            // DB failure — synthesise from products so the user still gets steps
            console.error("[assistant] build_route tool failed:", routeErr);
            if (routeSteps.length === 0 && allProducts.length > 0) {
              routeSteps = buildFallbackRouteSteps(allProducts, routeShopIds);
              routeSummary = routeSummary ||
                `${routeShopIds.length} stop${routeShopIds.length !== 1 ? "s" : ""}`;
            }
            toolResult = JSON.stringify({ built: routeSteps.length > 0, fallback: true, steps: routeSteps.length });
          }
        } else {
          toolResult = JSON.stringify({ error: `Unknown tool: ${fn.name}` });
        }
      } catch (err) {
        toolResult = JSON.stringify({ error: String(err) });
      }

      functionResponses.push({
        name: fn.name,
        response: { result: toolResult },
      });
    }

    // Send tool results back and continue the loop
    response = await chat.sendMessage({ message: functionResponses.map(fr => ({
      functionResponse: { name: fr.name, response: fr.response },
    })) });
  }

  // Loop exhausted without a final text response — use deterministic best-pick
  // message if we have products, otherwise a generic error.
  const exhaustedMessage = allProducts.length > 0
    ? buildProductFallbackMessage(allProducts, ctx.budget)
    : "I ran into an issue processing your request. Please try again.";

  return {
    message: exhaustedMessage,
    products: allProducts,
    route_steps: routeSteps,
    route_id: routeId,
    build_route: routeShopIds.length > 0,
    route_shop_ids: routeShopIds,
    route_summary: routeSummary,
  };
}
