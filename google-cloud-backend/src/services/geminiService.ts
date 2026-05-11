import { GoogleGenAI, Type, Tool, FunctionDeclaration, FunctionCallingConfigMode } from "@google/genai";
import { recommendProducts } from "./productService.js";
import { buildRoute } from "./routingService.js";
import { getSupabaseClient } from "../lib/supabase.js";
import type { ScoredProduct, RouteStep } from "../lib/types.js";

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
    "You are MallMind AI — a sharp, helpful shopping assistant for South African malls. You speak naturally in SA English.",
    "",
    ctx.mall_name
      ? `You are physically inside **${ctx.mall_name}** with the user right now.`
      : "No mall is selected yet. For product queries, ask the user to select a mall first.",
    ctx.current_floor ? `User is currently on Floor **${ctx.current_floor}**.` : "",
    ctx.shopping_intent ? `User's shopping goal: "${ctx.shopping_intent}"` : "",
    "",
    "Your rules:",
    "1. Call recommend_products FIRST for every product query — it searches live mall stock.",
    "2. Only answer from real data returned by tools. Do NOT invent store names, prices, or floor numbers.",
    "3. When the user wants directions, call build_route with the shop IDs from recommend_products.",
    "4. Call save_shopping_intent once you understand what the user is looking for.",
    "5. Use check_store_hours when asked about trading hours.",
    "6. Be concise — users are on their phone inside a busy mall.",
    "7. If recommend_products returns no results, say so clearly. Do not make up alternatives.",
    "",
    ctx.budget ? `Budget mode: R${ctx.budget.toLocaleString()} — prefer cheapest options and flag anything over budget.` : "",
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
        functionCallingConfig: { mode: FunctionCallingConfigMode.ANY },
      },
    },
  });

  for (let turn = 0; turn < 8; turn++) {
    const fnCalls = response.functionCalls ?? [];

    if (fnCalls.length === 0) {
      // No more tool calls — return final text
      return {
        message: response.text?.trim() || "Sorry, I couldn't generate a response.",
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
          if (ctx.session_id && routeShopIds.length) {
            const routeResult = await buildRoute(ctx.session_id, routeShopIds, ctx.user_id ?? null);
            routeSteps = routeResult.steps;
            routeId = routeResult.route_id;
            routeSummary = routeSummary || `${routeResult.stop_count} stops · ~${routeResult.estimated_minutes} min walk`;
            toolResult = JSON.stringify({ built: true, steps: routeResult.steps.length, estimated_minutes: routeResult.estimated_minutes });
          } else {
            toolResult = JSON.stringify({ built: false, message: "No active session — cannot persist route." });
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

  // Fallback if loop exhausted
  return {
    message: "I ran into an issue processing your request. Please try again.",
    products: allProducts,
    route_steps: routeSteps,
    route_id: routeId,
    build_route: routeShopIds.length > 0,
    route_shop_ids: routeShopIds,
    route_summary: routeSummary,
  };
}
