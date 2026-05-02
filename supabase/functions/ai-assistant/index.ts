/**
 * MallMind AI Assistant — Edge Function
 * Powered by Claude with tool use for real-time product search + route building.
 *
 * Deploy:
 *   supabase functions deploy ai-assistant
 *
 * Required secrets:
 *   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are MallMind AI — a smart, friendly shopping assistant for South African malls. You help users find products, compare prices, and plan efficient shopping routes.

You have real-time access to the product database for the user's selected mall. When a user mentions any product or item, search for it immediately using the search_products tool before responding.

Rules:
- Always search before answering product questions — never guess prices
- Show prices in Rand (R), rounded to nearest Rand
- When multiple stores stock the same item, highlight the cheapest
- When the user wants to visit multiple stores, call build_route with those shop IDs
- Be concise — users are on their phone, often in a busy mall
- Support South African English naturally (Afrikaans words like "lekker", "braai", "ja" are fine)
- If no products are found, say so honestly and suggest alternatives
- If the user has a budget, filter and mention total cost vs budget`;

const tools = [
  {
    name: "search_products",
    description: "Search for products available in the user's current mall. Call this for every product the user mentions.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Product name or description to search for" },
        max_price: { type: "number", description: "Maximum price in ZAR — only include if user mentioned a budget" },
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
          description: "IDs of shops to include in the route, in visit order (ground floor first)",
        },
        summary: { type: "string", description: "One-line summary like '3 stops, estimated 45 mins'" },
      },
      required: ["shop_ids"],
    },
  },
];

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
  }));
}

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
      : `${SYSTEM_PROMPT}\n\nNote: The user has not selected a mall yet. Remind them to select a mall before you can search for products.`;

    // Agentic tool-use loop — Claude may call tools multiple times
    const history = [...messages];
    const allProducts: ReturnType<typeof searchProducts> extends Promise<infer T> ? T : never[] = [];
    let routeShopIds: string[] = [];
    let routeSummary = "";

    for (let turn = 0; turn < 6; turn++) {
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
        const products = await Promise.all(allProducts as unknown as Promise<unknown>[]);
        return new Response(
          JSON.stringify({
            message: text,
            products: allProducts.flat(),
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

          if (block.name === "search_products" && mall_id) {
            const found = await searchProducts(block.input.query, mall_id, block.input.max_price);
            allProducts.push(...(found as never[]));
            result = found.length > 0
              ? `Found ${found.length} products: ${JSON.stringify(found)}`
              : `No products found matching "${block.input.query}" in this mall.`;
          } else if (block.name === "build_route") {
            routeShopIds = block.input.shop_ids.map(String);
            routeSummary = block.input.summary ?? "";
            result = `Route building triggered for ${routeShopIds.length} shops.`;
          } else {
            result = "Tool not available — no mall selected.";
          }

          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result,
          });
        }

        history.push({ role: "user", content: toolResults });
      } else {
        // Unexpected stop reason — return whatever we have
        break;
      }
    }

    return new Response(
      JSON.stringify({ message: "Sorry, I ran into an issue. Please try again.", products: [], build_route: false }),
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
