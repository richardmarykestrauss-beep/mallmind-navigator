import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Mic, MicOff, Send, Bot, User, Route as RouteIcon,
  Store, Sparkles, MapPin, Loader2, ShoppingBag, X
} from "lucide-react";
import MobileShell from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabaseClient";
import { useShoppingSession } from "@/context/ShoppingSessionContext";
import { cn } from "@/lib/utils";
import type { Shop } from "@/lib/supabaseClient";

const SUPABASE_URL = "https://qspsouemjtcdcfnivpnt.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_46teArH5kq3ndUUBHwLsjw_NnFRGCsI";

interface ProductResult {
  product_id: string;
  shop_id: string;
  name: string;
  brand: string | null;
  price: number;
  original_price: number | null;
  is_on_special: boolean;
  shop_name: string;
  floor: string | null;
  unit_number: string | null;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  products?: ProductResult[];
  routeShopIds?: string[];
  routeSummary?: string;
  loading?: boolean;
}

const FLOOR_ORDER: Record<string, number> = { B1: 0, G: 1, L1: 2, L2: 3, L3: 4, L4: 5 };

const STARTERS = [
  "Find me a TV under R5000",
  "Compare Nike sneakers",
  "What's the cheapest iPhone?",
  "I need headphones and a laptop bag",
  "Show me specials on appliances",
];

// ── Product card rendered inside assistant messages ──────────────────────────
function ProductCard({ p }: { p: ProductResult }) {
  const hasDiscount = p.is_on_special && p.original_price != null;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface/80 p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 border border-primary/20">
        <Store className="h-4 w-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold truncate">{p.name}</p>
        {p.brand && <p className="text-[10px] text-muted-foreground">{p.brand}</p>}
        <p className="text-[10px] text-muted-foreground">
          {p.shop_name} · Floor {p.floor ?? "?"} · {p.unit_number ?? "—"}
        </p>
      </div>
      <div className="text-right shrink-0">
        {hasDiscount && (
          <p className="text-[10px] text-muted-foreground line-through">
            R{p.original_price!.toFixed(0)}
          </p>
        )}
        <p className={cn(
          "font-display font-bold text-sm",
          hasDiscount ? "text-secondary" : "text-foreground"
        )}>
          R{p.price.toFixed(0)}
        </p>
        {hasDiscount && (
          <p className="text-[9px] uppercase tracking-wider text-secondary">Sale</p>
        )}
      </div>
    </div>
  );
}

// ── Typing indicator ──────────────────────────────────────────────────────────
function TypingIndicator() {
  return (
    <div className="flex items-end gap-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-primary/15 border border-primary/20">
        <Bot className="h-3.5 w-3.5 text-primary" />
      </div>
      <div className="rounded-2xl rounded-bl-sm border border-border bg-surface px-4 py-3">
        <div className="flex gap-1 items-center h-4">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-bounce"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
const AssistantPage = () => {
  const navigate = useNavigate();
  const { selectedMall, setRouteStops } = useShoppingSession();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speechSupported] = useState(() => {
    return typeof window !== "undefined" &&
      ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
  });

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Build the message history in the format Claude expects
  const buildHistory = useCallback((msgs: ChatMessage[]) => {
    return msgs
      .filter((m) => !m.loading)
      .map((m) => ({ role: m.role, content: m.content }));
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text.trim(),
    };

    const loadingMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      loading: true,
    };

    setMessages((prev) => [...prev, userMsg, loadingMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const history = buildHistory([...messages, userMsg]);

      const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-assistant`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          messages: history,
          mall_id: selectedMall?.id ? String(selectedMall.id) : null,
          mall_name: selectedMall?.name ?? null,
        }),
      });

      const data = await res.json();

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.message ?? "Sorry, I couldn't get a response.",
        products: data.products?.length ? data.products : undefined,
        routeShopIds: data.build_route ? data.route_shop_ids : undefined,
        routeSummary: data.route_summary,
      };

      setMessages((prev) => prev.filter((m) => !m.loading).concat(assistantMsg));
    } catch {
      setMessages((prev) =>
        prev.filter((m) => !m.loading).concat({
          id: crypto.randomUUID(),
          role: "assistant",
          content: "Something went wrong. Please check your connection and try again.",
        })
      );
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, messages, buildHistory, selectedMall]);

  function handleSend() {
    sendMessage(input);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function startVoice() {
    if (!speechSupported) return;
    const SR = (window as typeof window & { webkitSpeechRecognition?: typeof SpeechRecognition })
      .SpeechRecognition ?? (window as typeof window & { webkitSpeechRecognition?: typeof SpeechRecognition }).webkitSpeechRecognition;
    if (!SR) return;

    const recognition = new SR();
    recognition.lang = "en-ZA";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (e: SpeechRecognitionEvent) => {
      const transcript = e.results[0][0].transcript;
      setInput(transcript);
      setIsListening(false);
      recognitionRef.current = null;
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }

  function stopVoice() {
    recognitionRef.current?.stop();
    setIsListening(false);
  }

  async function handleBuildRoute(shopIds: string[]) {
    // Fetch shop details and build route
    const { data } = await supabase
      .from("shops")
      .select("id, mall_id, name, floor, unit_number, category, opening_hours")
      .in("id", shopIds);

    if (!data?.length) return;

    const sorted = [...data].sort((a, b) => {
      const aOrd = FLOOR_ORDER[a.floor ?? ""] ?? 99;
      const bOrd = FLOOR_ORDER[b.floor ?? ""] ?? 99;
      if (aOrd !== bOrd) return aOrd - bOrd;
      return (a.unit_number ?? "").localeCompare(b.unit_number ?? "");
    });

    setRouteStops(sorted as Shop[]);
    navigate("/navigate");
  }

  const isEmpty = messages.length === 0;

  return (
    <MobileShell>
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 border border-primary/30 glow-primary">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="font-display font-bold text-sm">MallMind AI</p>
            <p className="text-[10px] text-muted-foreground">
              {selectedMall ? selectedMall.name : "Select a mall to start"}
            </p>
          </div>
        </div>
        {selectedMall && (
          <div className="flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs text-primary">
            <MapPin className="h-3 w-3" />
            {selectedMall.city ?? selectedMall.name}
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 pb-6">
        {/* Empty state */}
        {isEmpty && (
          <div className="flex flex-col items-center gap-5 pt-8 animate-fade-in">
            <div className="relative flex h-20 w-20 items-center justify-center">
              <div className="absolute h-20 w-20 rounded-full bg-primary/10 blur-xl animate-float" />
              <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-primary glow-primary animate-float">
                <Bot className="h-8 w-8 text-primary-foreground" />
              </div>
            </div>
            <div className="text-center">
              <p className="font-display font-bold text-lg">Hey, I'm MallMind AI</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-[260px] leading-relaxed">
                Tell me what you're looking for and I'll find the best prices across all stores.
              </p>
            </div>
            {!selectedMall && (
              <Button variant="glass" size="sm" onClick={() => navigate("/malls")}>
                <MapPin className="h-4 w-4" />
                Choose a Mall First
              </Button>
            )}
            <div className="w-full space-y-2">
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground px-1">
                Try asking
              </p>
              {STARTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => sendMessage(s)}
                  className="w-full flex items-center gap-2 rounded-xl border border-border bg-surface/60 px-4 py-3 text-sm text-left hover:border-primary/40 hover:bg-surface transition-all"
                >
                  <ShoppingBag className="h-4 w-4 text-primary shrink-0" />
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Message list */}
        {messages.map((msg) => (
          <div key={msg.id} className={cn("flex gap-2", msg.role === "user" ? "flex-row-reverse" : "flex-row")}>
            {/* Avatar */}
            <div className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-xl self-end",
              msg.role === "user"
                ? "bg-secondary/20 border border-secondary/30"
                : "bg-primary/15 border border-primary/20"
            )}>
              {msg.role === "user"
                ? <User className="h-3.5 w-3.5 text-secondary" />
                : <Bot className="h-3.5 w-3.5 text-primary" />
              }
            </div>

            {/* Bubble */}
            <div className={cn(
              "max-w-[80%] space-y-2",
              msg.role === "user" ? "items-end" : "items-start"
            )}>
              {msg.loading ? (
                <TypingIndicator />
              ) : (
                <>
                  {msg.content && (
                    <div className={cn(
                      "rounded-2xl px-4 py-3 text-sm leading-relaxed",
                      msg.role === "user"
                        ? "rounded-br-sm bg-primary text-primary-foreground"
                        : "rounded-bl-sm border border-border bg-surface"
                    )}>
                      {msg.content}
                    </div>
                  )}

                  {/* Product cards */}
                  {msg.products && msg.products.length > 0 && (
                    <div className="space-y-2 w-full max-w-[300px]">
                      {msg.products.map((p, i) => (
                        <ProductCard key={`${p.product_id}-${i}`} p={p} />
                      ))}
                    </div>
                  )}

                  {/* Route action */}
                  {msg.routeShopIds && msg.routeShopIds.length > 0 && (
                    <div className="rounded-2xl border border-primary/30 bg-primary/10 p-3 space-y-2 w-full max-w-[300px]">
                      <div className="flex items-center gap-2">
                        <RouteIcon className="h-4 w-4 text-primary" />
                        <p className="text-xs font-semibold text-primary">
                          Route ready · {msg.routeShopIds.length} stops
                        </p>
                      </div>
                      {msg.routeSummary && (
                        <p className="text-[11px] text-muted-foreground">{msg.routeSummary}</p>
                      )}
                      <Button
                        variant="neon"
                        size="sm"
                        className="w-full"
                        onClick={() => handleBuildRoute(msg.routeShopIds!)}
                      >
                        <RouteIcon className="h-4 w-4" />
                        Start Navigation
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="shrink-0 px-4 pb-24 pt-2 border-t border-border/50 bg-background/80 backdrop-blur">
        {/* Clear chat */}
        {messages.length > 0 && !isLoading && (
          <div className="flex justify-end mb-2">
            <button
              onClick={() => setMessages([])}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3 w-3" />
              Clear chat
            </button>
          </div>
        )}

        <div className="flex items-center gap-2">
          {speechSupported && (
            <button
              onClick={isListening ? stopVoice : startVoice}
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-all",
                isListening
                  ? "border-secondary/50 bg-secondary/15 text-secondary glow-secondary animate-pulse"
                  : "border-border bg-surface/60 text-muted-foreground hover:text-foreground"
              )}
            >
              {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
          )}

          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isListening ? "Listening…" : "Ask about any product…"}
            disabled={isLoading}
            className="flex-1 h-11 rounded-2xl border border-border bg-surface/80 px-4 text-sm focus:outline-none focus:border-primary/50 focus:shadow-[0_0_0_3px_hsl(190_100%_50%/0.15)] transition-all disabled:opacity-50"
          />

          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-all",
              input.trim() && !isLoading
                ? "border-primary/50 bg-primary/15 text-primary hover:bg-primary/20 glow-primary"
                : "border-border bg-surface/60 text-muted-foreground opacity-50"
            )}
          >
            {isLoading
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Send className="h-4 w-4" />
            }
          </button>
        </div>
      </div>
    </MobileShell>
  );
};

export default AssistantPage;
