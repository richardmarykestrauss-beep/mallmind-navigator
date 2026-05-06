/**
 * MallMind AI Assistant — Edge Function (v2)
 * Full session-context-aware assistant. Knows which mall the user is in,
 * their current floor, shopping intent, and active route.
 *
 * Tools: recommend_products, search_web, check_store_hours,
 *        save_shopping_intent, build_route
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const GEMINI_API_KEY    = Deno.env.get("GEMINI_API_KEY");

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface SessionContext {
  mall_id?: string | null;
  mall_name?: string | null;
  session_id?: string | null;
  user_id?: string | null;
  current_floor?: string | null;
  current_lat?: number | null;
  current_lng?: number | null;
  shopping_intent?: string | null;
  shopping_list?: string[] | null;
  budget?: number | null;
}

interface ProductRow {
  id: string; shop_id: string; name: string; brand: string | null;
  price: number; original_price: number | null; is_on_special: boolean;
}

interface ShopRow {
  id: string; name: string; floor: string | null;
  unit_number: string | null; opening_hours: string | null;
}

interface WebResult { answer: string; sources: string[]; }

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(ctx: SessionContext): string {
  const lines = [
    `You are MallMind AI — a sharp, friendly shopping assistant for South African malls. You speak naturally in SA English.`,
    ``,
    ctx.mall_name
      ? `You are physically inside **${ctx.mall_name}** with the user right now.`
      : `No mall is selected yet. Use search_web for general prices and ask the user to select a mall.`,
    ctx.current_floor ? `User is on **Floor ${ctx.current_floor}**.` : "",
    ctx.shopping_intent ? `Shopping goal: "${ctx.shopping_intent}"` : "",
    ctx.shopping_list?.length ? `Shopping list: ${ctx.shopping_list.join(", ")}` : "",
    ``,
    `Your job:`,
    `1. Use recommend_products FIRST for every product query — it searches live mall stock`,
    `2. Fall back to search_web ONLY if recommend_products returns nothing`,
    `3. When showing web results, say "web estimate — not verified in-store"`,
    `4. Once the user picks stores, call build_route`,
    `5. Call save_shopping_intent early once you understand their goal`,
    `6. Use check_store_hours when asked about a store's trading hours`,
    `7. Be concise — users are on their phone in a busy mall`,
    ``,
    `Price rules:`,
    `- Prices in Rand (R), whole numbers`,
    `- Highlight cheapest option and any specials`,
    `- Call out savings: "saves you R450 vs the next store"`,
    ``,
    `Never give generic answers when inside a mall — be specific to what's available at ${ctx.mall_name ?? "their mall"}.`,
  ];
  return lines.filter((l) => l !== undefined).join("\n");
}

function buildBudgetContext(budget: number): string {
  return `

Budget mode: R${budget.toLocaleString()}
- Prefer cheapest options, highlight deals
- End every response with: "💰 Total: Rxx of your R${budget.toLocaleString()} budget (Rxx remaining)"
- Flag items that exceed budget and suggest alternatives`;
}

// ── Tool implementations ──────────────────────────────────────────────────────

async function recommendProducts(mallId: string, query: string, budget?: number | null, category?: string | null) {
  const { data: shops } = await supabase
    .from("shops")
    .select("id, name, floor, unit_number, opening_hours")
    .eq("mall_id", mallId);

  if (!shops?.length) return { found: false, message: "No shops found in this mall." };

  const shopMap = Object.fromEntries((shops as ShopRow[]).map((s) => [String(s.id), s]));
  const shopIds = (shops as ShopRow[]).map((s) => s.id);

  let q = supabase
    .from("products")
    .select("id, shop_id, name, brand, price, original_price, is_on_special")
    .in("shop_id", shopIds)
    .ilike("name", `%${query}%`)
    .eq("in_stock", true)
    .order("price", { ascending: true })
    .limit(12);

  if (budget != null) q = q.lte("price", budget);
  if (category)       q = q.ilike("category", `%${category}%`);

  const { data: products } = await q;
  if (!products?.length) return { found: false, message: `Nothing found for "${query}" at this mall.` };

  const cheapest: Record<string, number> = {};
  for (const p of products as ProductRow[]) {
    const key = p.name.toLowerCase();
    if (!cheapest[key] || p.price < cheapest[key]) cheapest[key] = p.price;
  }

  const results = (products as ProductRow[]).map((p) => {
    const shop = shopMap[String(p.shop_id)] as ShopRow;
    const isCheapest = cheapest[p.name.toLowerCase()] === p.price;
    const discPct = p.is_on_special && p.original_price
      ? Math.round((1 - p.price / p.original_price) * 100) : null;
    return {
      product_id:    String(p.id),
      shop_id:       String(p.shop_id),
      name:          p.name,
      brand:         p.brand,
      price:         p.price,
      original_price: p.original_price,
      is_on_special: p.is_on_special,
      discount_pct:  discPct,
      shop_name:     shop?.name ?? "Unknown",
      floor:         shop?.floor ?? null,
      unit_number:   shop?.unit_number ?? null,
      is_cheapest:   isCheapest,
      reason:        [
        isCheapest ? "Cheapest in mall" : null,
        discPct    ? `${discPct}% off` : null,
        budget && p.price <= budget ? `R${Math.round(budget - p.price)} under budget` : null,
      ].filter(Boolean).join(" · ") || "Available in mall",
    };
  });

  return { found: true, count: results.length, results };
}

async function checkStoreHours(mallId: string, shopName: string) {
  const { data: shops } = await supabase
    .from("shops")
    .select("id, name, floor, unit_number, opening_hours")
    .eq("mall_id", mallId)
    .ilike("name", `%${shopName}%`)
    .limit(3);

  if (!shops?.length) return { found: false, message: `No store named "${shopName}" found here.` };

  const now = new Date();
  const saHour = (now.getUTCHours() + 2) % 24;
  const saMin  = now.getUTCMinutes();

  return {
    found: true,
    stores: (shops as ShopRow[]).map((s) => {
      let isOpen: boolean | null = null;
      if (s.opening_hours) {
        const m = s.opening_hours.match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/);
        if (m) isOpen = saHour >= parseInt(m[1]) && saHour < parseInt(m[3]);
      }
      return {
        name: s.name, floor: s.floor, unit_number: s.unit_number,
        opening_hours: s.opening_hours ?? "Hours unavailable",
        current_time_sa: `${String(saHour).padStart(2,"0")}:${String(saMin).padStart(2,"0")}`,
        is_open: isOpen,
      };
    }),
  };
}

async function saveShoppingIntent(sessionId: string | null | undefined, intent: string) {
  if (!sessionId) return { saved: false };
  await supabase
    .from("shopping_sessions")
    .update({ shopping_intent: intent, last_seen_at: new Date().toISOString() })
    .eq("id", sessionId);
  return { saved: true, intent };
}

async function searchWeb(query: string): Promise<WebResult> {
  if (!GEMINI_API_KEY) return { answer: "Web search not configured.", sources: [] };
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: `Current retail price of ${query} in South Africa? Price in Rand (R). Cheapest option + stores. 2-3 sentences.` }] }],
          tools: [{ google_search: {} }],
          generationConfig: { maxOutputTokens: 256 },
        }),
      }
    );
    if (!res.ok) return { answer: "Web search unavailable.", sources: [] };
    const data = await res.json();
    const parts  = data.candidates?.[0]?.content?.parts ?? [];
    const answer = parts.map((p: { text?: string }) => p.text ?? "").join("").trim();
    const chunks = data.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const sources = chunks.map((c: { web?: { uri?: string } }) => c.web?.uri).filter(Boolean).slice(0, 3);
    return { answer: answer || "No results.", sources };
  } catch {
    return { answer: "Web search failed.", sources: [] };
  }
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const tools = [
  {
    name: "recommend_products",
    description: "Search live mall stock for products. Returns ranked results with prices, store locations and discounts. ALWAYS call this first for any product query when inside a mall.",
    input_schema: {
      type: "object",
      properties: {
        query:    { type: "string",  description: "Product name or description" },
        budget:   { type: "number",  description: "Max price in ZAR (only set if user mentioned a budget)" },
        category: { type: "string",  description: "Optional category e.g. Electronics, Clothing, Appliances" },
      },
      required: ["query"],
    },
  },
  {
    name: "search_web",
    description: "Search Google for SA retail prices via Gemini. Only use if recommend_products returns nothing.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "e.g. 'Sony WH-1000XM6 price South Africa 2025'" },
      },
      required: ["query"],
    },
  },
  {
    name: "check_store_hours",
    description: "Check if a specific store is open now and get its trading hours.",
    input_schema: {
      type: "object",
      properties: {
        shop_name: { type: "string", description: "Store name e.g. Game, Woolworths, Clicks" },
      },
      required: ["shop_name"],
    },
  },
  {
    name: "save_shopping_intent",
    description: "Save the user's shopping goal to their active session. Call this once you understand what they're looking for.",
    input_schema: {
      type: "object",
      properties: {
        intent: { type: "string", description: "e.g. 'Looking for a 65 inch TV under R15000 and Nike sneakers'" },
      },
      required: ["intent"],
    },
  },
  {
    name: "build_route",
    description: "Trigger navigation to selected stores. Call when the user has decided which stores to visit.",
    input_schema: {
      type: "object",
      properties: {
        shop_ids: { type: "array", items: { type: "string" }, description: "Shop IDs — ground floor first" },
        summary:  { type: "string", description: "e.g. '2 stops · ~15 min walk'" },
      },
      required: ["shop_ids"],
    },
  },
];

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST")    return new Response("Method not allowed", { status: 405, headers: CORS });

  try {
    const body = await req.json();
    const { messages, mall_id, mall_name, budget, user_id, session_id,
            current_floor, current_lat, current_lng, shopping_intent, shopping_list } = body;

    if (!messages?.length) {
      return new Response(JSON.stringify({ error: "messages required" }), { status: 400, headers: { "Content-Type": "application/json", ...CORS } });
    }

    const ctx: SessionContext = {
      mall_id, mall_name, session_id, user_id,
      current_floor, current_lat, current_lng,
      shopping_intent, shopping_list,
      budget: budget ? Number(budget) : null,
    };

    const systemPrompt = buildSystemPrompt(ctx) + (ctx.budget ? buildBudgetContext(ctx.budget) : "");
    const history = [...messages];

    // Accumulate products across all tool calls for frontend rendering
    const allProducts: ReturnType<typeof recommendProducts> extends Promise<infer T> ? (T extends { results?: infer R } ? (R extends unknown[] ? R[number] : never) : never)[] : never[] = [];
    const webResults: WebResult[] = [];
    let routeShopIds: string[] = [];
    let routeSummary = "";

    for (let turn = 0; turn < 8; turn++) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key":         ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type":      "application/json",
        },
        body: JSON.stringify({
          model:     "claude-haiku-4-5-20251001",
          max_tokens: 1024,
          system:    systemPrompt,
          tools,
          messages:  history,
        }),
      });

      if (!res.ok) { console.error("Anthropic error:", await res.json()); break; }

      const data = await res.json();

      if (data.stop_reason === "end_turn") {
        const text = data.content?.find((c: { type: string; text?: string }) => c.type === "text")?.text ?? "";
        return new Response(
          JSON.stringify({ message: text, products: allProducts, web_results: webResults, route_shop_ids: routeShopIds, route_summary: routeSummary, build_route: routeShopIds.length > 0 }),
          { headers: { "Content-Type": "application/json", ...CORS } }
        );
      }

      if (data.stop_reason === "tool_use") {
        history.push({ role: "assistant", content: data.content });
        const toolResults = [];

        for (const block of data.content) {
          if (block.type !== "tool_use") continue;
          let result: string;

          if (block.name === "recommend_products") {
            if (mall_id) {
              const found = await recommendProducts(mall_id, block.input.query, block.input.budget ?? ctx.budget, block.input.category);
              if (found.found && found.results) {
                (allProducts as unknown[]).push(...(found.results as unknown[]));
              }
              result = JSON.stringify(found);
            } else {
              result = "No mall selected. Prompt user to pick a mall, then use search_web.";
            }

          } else if (block.name === "search_web") {
            const webResult = await searchWeb(block.input.query);
            webResults.push(webResult);
            result = `Web: ${webResult.answer}${webResult.sources.length ? ` Sources: ${webResult.sources.join(", ")}` : ""}`;

          } else if (block.name === "check_store_hours") {
            result = mall_id
              ? JSON.stringify(await checkStoreHours(mall_id, block.input.shop_name))
              : "No mall selected.";

          } else if (block.name === "save_shopping_intent") {
            result = JSON.stringify(await saveShoppingIntent(session_id, block.input.intent));

          } else if (block.name === "build_route") {
            routeShopIds = block.input.shop_ids.map(String);
            routeSummary = block.input.summary ?? "";
            if (session_id) {
              await supabase.from("shopping_sessions")
                .update({ route_stop_ids: JSON.stringify(routeShopIds), last_seen_at: new Date().toISOString() })
                .eq("id", session_id);
            }
            result = `Route set for ${routeShopIds.length} shops.`;

          } else {
            result = "Unknown tool.";
          }

          toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
        }

        history.push({ role: "user", content: toolResults });
      } else {
        break;
      }
    }

    return new Response(
      JSON.stringify({ message: "Something went wrong — please try again.", products: [], web_results: [], build_route: false }),
      { headers: { "Content-Type": "application/json", ...CORS } }
    );
  } catch (err) {
    console.error("ai-assistant error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { "Content-Type": "application/json", ...CORS } });
  }
});
