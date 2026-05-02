/**
 * MallMind AI Assistant — Edge Function
 * Claude (tool use) + Gemini Flash (Google Search grounding) hybrid.
 *
 * Flow:
 *   1. Claude searches your Supabase product DB via search_products tool
 *   2. If nothing found, Claude calls search_web → Gemini Flash queries Google
 *   3. Claude presents both sources clearly, flagging web results as estimates
 *
 * Deploy:
 *   supabase functions deploy ai-assistant
 *
 * Required secrets:
 *   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
 *   supabase secrets set GEMINI_API_KEY=AIza...
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are MallMind AI — a smart, friendly shopping assistant for South African malls. You help users find products, compare prices, and plan efficient shopping routes.

You have two data sources:
1. search_products — your mall's live product database (preferred, always try this first)
2. search_web — Google Search via Gemini (fallback only, when search_products returns nothing)

Rules:
- Always try search_products first for every product mentioned
- Only call search_web if search_products found nothing for that specific item
- When showing web results, clearly say it's a web estimate and not verified in-store
- Show prices in Rand (R), rounded to nearest Rand
- When multiple stores stock the same item, highlight the cheapest
- Call build_route when the user has decided which stores to visit
- Be concise — users are on their phone in a busy mall
- Support South African English naturally (Afrikaans words are fine)
- If nothing is found anywhere, say so and suggest alternatives`;

const tools = [
  {
    name: "search_products",
    description: "Search the user's mall live product database. Always call this first for any product query.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Product name or description" },
        max_price: { type: "number", description: "Maximum price in ZAR — only set if user mentioned a budget" },
      },
      required: ["query"],
    },
  },
  {
    name: "search_web",
    description: "Search Google for SA retail prices via Gemini. Use ONLY as a fallback when search_products returns no results. Results are web estimates, not verified in-store prices.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query e.g. 'Sony WH-1000XM6 price South Africa 2025'" },
      },
      required: ["query"],
    },
  },
  {
    name: "build_route",
    description: "Trigger the app to build a navigation route to specific stores. Call this when the user has decided which stores to visit.",
    input_schema: {
      type: "object",
      properties: {
        shop_ids: {
          type: "array",
          items: { type: "string" },
          description: "IDs of shops to include in the route, ground floor first",
        },
        summary: { type: "string", description: "e.g. '3 stops, estimated 40 mins'" },
      },
      required: ["shop_ids"],
    },
  },
];

// ── Tool: search Supabase ────────────────────────────────────────────────────

interface ProductRow {
  id: string | number;
  shop_id: string | number;
  name: string;
  brand: string | null;
  price: number;
  original_price: number | null;
  is_on_special: boolean;
}

interface ShopRow {
  id: string | number;
  name: string;
  floor: string | null;
  unit_number: string | null;
}

async function searchProducts(query: string, mallId: string, maxPrice?: number) {
  const { data: shops } = await supabase
    .from("shops")
    .select("id, name, floor, unit_number")
    .eq("mall_id", mallId);

  if (!shops?.length) return [];

  let q = supabase
    .from("products")
    .select("id, shop_id, name, brand, price, original_price, is_on_special")
    .in("shop_id", (shops as ShopRow[]).map((s) => s.id))
    .ilike("name", `%${query}%`)
    .eq("in_stock", true)
    .order("price", { ascending: true })
    .limit(6);

  if (maxPrice) q = q.lte("price", maxPrice);

  const { data: products } = await q;
  if (!products?.length) return [];

  const shopMap = Object.fromEntries((shops as ShopRow[]).map((s) => [String(s.id), s]));

  return (products as ProductRow[]).map((p) => ({
    product_id: String(p.id),
    shop_id: String(p.shop_id),
    name: p.name,
    brand: p.brand,
    price: p.price,
    original_price: p.original_price,
    is_on_special: p.is_on_special,
    shop_name: shopMap[String(p.shop_id)]?.name ?? "Unknown Store",
    floor: shopMap[String(p.shop_id)]?.floor ?? null,
    unit_number: shopMap[String(p.shop_id)]?.unit_number ?? null,
    source: "database" as const,
  }));
}

// ── Tool: Gemini web search ──────────────────────────────────────────────────

interface WebSearchResult {
  answer: string;
  sources: string[];
}

async function searchWeb(query: string): Promise<WebSearchResult> {
  if (!GEMINI_API_KEY) {
    return { answer: "Web search is not configured.", sources: [] };
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [{
              text: `What is the current retail price of ${query} in South Africa? ` +
                `Give the price in Rand (R). Mention the cheapest option and which stores sell it. ` +
                `Be concise — 2-3 sentences max.`,
            }],
          }],
          tools: [{ google_search: {} }],
          generationConfig: { maxOutputTokens: 256 },
        }),
      }
    );

    if (!res.ok) {
      return { answer: "Web search unavailable right now.", sources: [] };
    }

    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const answer = parts.map((p: { text?: string }) => p.text ?? "").join("").trim();
    const chunks = data.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const sources: string[] = chunks
      .map((c: { web?: { uri?: string } }) => c.web?.uri)
      .filter(Boolean)
      .slice(0, 3);

    return { answer: answer || "No web results found.", sources };
  } catch {
    return { answer: "Web search failed.", sources: [] };
  }
}

// ── Edge function handler ────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS });
  }

  try {
    const { messages, mall_id, mall_name } = await req.json();

    if (!messages?.length) {
      return new Response(JSON.stringify({ error: "messages required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    const systemPrompt = mall_id
      ? `${SYSTEM_PROMPT}\n\nUser's current mall: ${mall_name ?? "Unknown"} (mall_id: ${mall_id})`
      : `${SYSTEM_PROMPT}\n\nNote: No mall selected yet. You can still use search_web for general price info, but remind the user to select a mall for in-store results.`;

    const history = [...messages];
    const allProducts: ReturnType<typeof searchProducts> extends Promise<infer T> ? T : never[] = [];
    const webResults: WebSearchResult[] = [];
    let routeShopIds: string[] = [];
    let routeSummary = "";

    // Agentic loop — Claude may call multiple tools before final answer
    for (let turn = 0; turn < 8; turn++) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1024,
          system: systemPrompt,
          tools,
          messages: history,
        }),
      });

      const data = await res.json();

      if (data.stop_reason === "end_turn") {
        const text = data.content?.find((c: { type: string; text?: string }) => c.type === "text")?.text ?? "";
        return new Response(
          JSON.stringify({
            message: text,
            products: allProducts.flat(),
            web_results: webResults,
            route_shop_ids: routeShopIds,
            route_summary: routeSummary,
            build_route: routeShopIds.length > 0,
          }),
          { headers: { "Content-Type": "application/json", ...CORS } }
        );
      }

      if (data.stop_reason === "tool_use") {
        history.push({ role: "assistant", content: data.content });

        const toolResults = [];
        for (const block of data.content) {
          if (block.type !== "tool_use") continue;

          let result: string;

          if (block.name === "search_products") {
            if (mall_id) {
              const found = await searchProducts(block.input.query, mall_id, block.input.max_price);
              allProducts.push(...(found as never[]));
              result = found.length > 0
                ? `Found ${found.length} products in database: ${JSON.stringify(found)}`
                : `No products found in database for "${block.input.query}". You may want to try search_web as a fallback.`;
            } else {
              result = "No mall selected — cannot search database. Use search_web for general price info.";
            }
          } else if (block.name === "search_web") {
            const webResult = await searchWeb(block.input.query);
            webResults.push(webResult);
            result = `Web search result: ${webResult.answer}${webResult.sources.length ? ` Sources: ${webResult.sources.join(", ")}` : ""}`;
          } else if (block.name === "build_route") {
            routeShopIds = block.input.shop_ids.map(String);
            routeSummary = block.input.summary ?? "";
            result = `Route building triggered for ${routeShopIds.length} shops.`;
          } else {
            result = "Unknown tool.";
          }

          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result,
          });
        }

        history.push({ role: "user", content: toolResults });
      } else {
        break;
      }
    }

    return new Response(
      JSON.stringify({ message: "I ran into an issue. Please try again.", products: [], web_results: [], build_route: false }),
      { headers: { "Content-Type": "application/json", ...CORS } }
    );
  } catch (err) {
    console.error("ai-assistant error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS } }
    );
  }
});
