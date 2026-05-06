import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Mic, MicOff, Send, Bot, User, Route as RouteIcon,
  Store, Sparkles, MapPin, Loader2, ShoppingBag, X, Globe,
  Volume2, VolumeX, Wallet, ChevronRight
} from "lucide-react";
import MobileShell from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import RecommendationCard, { type ProductResult } from "@/components/RecommendationCard";
import { supabase } from "@/lib/supabaseClient";
import { useShoppingSession } from "@/context/ShoppingSessionContext";
import { useAuth } from "@/context/AuthContext";
import { useGeoLocation } from "@/context/LocationContext";
import { trackEvent } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import type { Shop } from "@/lib/supabaseClient";

const SUPABASE_URL = "https://qspsouemjtcdcfnivpnt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFzcHNvdWVtanRjZGNmbml2cG50Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMTIzNTAsImV4cCI6MjA5MjY4ODM1MH0.f94Lbzo-EgmcMsklgYiWW6tNhM4hvGm2Z8_37Xp8nkg";

// ProductResult imported from RecommendationCard component

interface WebResult {
  answer: string;
  sources: string[];
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  products?: ProductResult[];
  webResults?: WebResult[];
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
  "Budget mode: spend under R3000 on my whole list",
];

// ── Budget helpers ────────────────────────────────────────────────────────────

/**
 * Group products by first 3 words of name, keep cheapest per group.
 * Gives a reasonable "what would this shopping trip cost at cheapest options" total.
 */
function computeTotalCost(products: ProductResult[]): number {
  const groups: Record<string, number> = {};
  for (const p of products) {
    const key = p.name.toLowerCase().split(/\s+/).slice(0, 3).join(" ");
    if (groups[key] === undefined || p.price < groups[key]) {
      groups[key] = p.price;
    }
  }
  return Object.values(groups).reduce((sum, price) => sum + price, 0);
}

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

// ── Web estimate card ─────────────────────────────────────────────────────────
function WebResultCard({ result }: { result: WebResult }) {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Globe className="h-3.5 w-3.5 text-amber-400 shrink-0" />
        <span className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">
          Web estimate · not verified in-store
        </span>
      </div>
      <p className="text-xs leading-relaxed text-foreground/90">{result.answer}</p>
      {result.sources.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {result.sources.map((src, i) => {
            let label = src;
            try { label = new URL(src).hostname.replace("www.", ""); } catch { /* ignore */ }
            return (
              <a
                key={i}
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[9px] text-amber-400/80 underline underline-offset-2 hover:text-amber-400"
              >
                {label}
              </a>
            );
          })}
        </div>
      )}
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

// ── Markdown renderer (no external deps) ─────────────────────────────────────

function renderInline(text: string): React.ReactNode {
  // Split on **bold** and *italic* markers
  const parts = text.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*"))
      return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
}

function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Empty line → skip (natural spacing from parent space-y)
    if (!line.trim()) { i++; continue; }

    // Bullet list block
    if (/^[-*•]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*•]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*•]\s+/, ""));
        i++;
      }
      nodes.push(
        <ul key={`ul-${i}`} className="list-disc list-inside space-y-0.5 my-0.5">
          {items.map((item, j) => <li key={j}>{renderInline(item)}</li>)}
        </ul>
      );
      continue;
    }

    // Numbered list block
    if (/^\d+[.)]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+[.)]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+[.)]\s+/, ""));
        i++;
      }
      nodes.push(
        <ol key={`ol-${i}`} className="list-decimal list-inside space-y-0.5 my-0.5">
          {items.map((item, j) => <li key={j}>{renderInline(item)}</li>)}
        </ol>
      );
      continue;
    }

    // Heading
    const hMatch = line.match(/^(#{1,3})\s+(.*)/);
    if (hMatch) {
      nodes.push(
        <p key={`h-${i}`} className="font-semibold text-foreground mt-1">
          {renderInline(hMatch[2])}
        </p>
      );
      i++; continue;
    }

    // Regular paragraph
    nodes.push(<p key={`p-${i}`}>{renderInline(line)}</p>);
    i++;
  }

  return <div className="space-y-1 text-sm leading-relaxed">{nodes}</div>;
}

// ── TTS helpers ───────────────────────────────────────────────────────────────

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/#{1,6}\s/g, "")
    .replace(/`[^`]+`/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, ", ")
    .trim();
}

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  const priority = ["en-ZA", "en-GB", "en-AU", "en-US"];
  for (const lang of priority) {
    const v = voices.find((v) => v.lang === lang);
    if (v) return v;
  }
  return voices.find((v) => v.lang.startsWith("en")) ?? voices[0] ?? null;
}

// ── Main page ─────────────────────────────────────────────────────────────────
const AssistantPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { selectedMall, setRouteStops, dbSessionId, shoppingIntent, updateSessionRoute } = useShoppingSession();
  const { user } = useAuth();
  const { position } = useGeoLocation();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const voiceErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [speechSupported] = useState(() => {
    return typeof window !== "undefined" &&
      ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
  });
  // Voice requires HTTPS — detect HTTP and warn
  const isHttps = typeof window !== "undefined" && window.location.protocol === "https:";

  // Budget state
  const [budget, setBudget] = useState<number | null>(null);
  const [budgetInput, setBudgetInput] = useState("");
  const [showBudgetInput, setShowBudgetInput] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const budgetInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const prefillFiredRef = useRef(false);

  // TTS
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;
  const ttsUnlockedRef = useRef(false);

  const unlockTts = useCallback(() => {
    if (!ttsSupported || ttsUnlockedRef.current) return;
    ttsUnlockedRef.current = true;
    const silent = new SpeechSynthesisUtterance(" ");
    silent.volume = 0;
    silent.rate = 10;
    window.speechSynthesis.speak(silent);
  }, [ttsSupported]);

  const speak = useCallback((text: string) => {
    if (!ttsEnabled || !ttsSupported) return;
    window.speechSynthesis.cancel();
    const clean = stripMarkdown(text);
    if (!clean) return;
    const utter = new SpeechSynthesisUtterance(clean);
    utter.lang = "en-ZA";
    utter.rate = 1.05;
    utter.pitch = 1.0;
    const trySpeak = () => {
      const voice = pickVoice();
      if (voice) utter.voice = voice;
      window.speechSynthesis.speak(utter);
    };
    if (window.speechSynthesis.getVoices().length > 0) {
      trySpeak();
    } else {
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.onvoiceschanged = null;
        trySpeak();
      };
    }
  }, [ttsEnabled, ttsSupported]);

  const stopSpeech = useCallback(() => {
    if (ttsSupported) window.speechSynthesis.cancel();
  }, [ttsSupported]);

  useEffect(() => () => stopSpeech(), [stopSpeech]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus budget input when it opens
  useEffect(() => {
    if (showBudgetInput) {
      setTimeout(() => budgetInputRef.current?.focus(), 50);
    }
  }, [showBudgetInput]);

  // Compute running total from all assistant messages' products
  const allFoundProducts = messages
    .filter((m) => m.products?.length)
    .flatMap((m) => m.products!);
  const totalCost = allFoundProducts.length > 0 ? computeTotalCost(allFoundProducts) : 0;
  const budgetPct = budget ? Math.min(100, (totalCost / budget) * 100) : 0;
  const overBudget = budget !== null && totalCost > budget;

  function confirmBudget() {
    const val = parseFloat(budgetInput.replace(/[^0-9.]/g, ""));
    if (!isNaN(val) && val > 0) {
      setBudget(val);
      setBudgetInput("");
      setShowBudgetInput(false);
    }
  }

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

    stopSpeech();
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
          messages:        history,
          mall_id:         selectedMall?.id ? String(selectedMall.id) : null,
          mall_name:       selectedMall?.name ?? null,
          budget:          budget ?? undefined,
          user_id:         user?.id ?? null,
          session_id:      dbSessionId ?? null,
          current_lat:     position?.lat ?? null,
          current_lng:     position?.lng ?? null,
          shopping_intent: shoppingIntent ?? null,
        }),
      });

      const data = await res.json();

      const replyText = data.message ?? "Sorry, I couldn't get a response.";
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: replyText,
        products: data.products?.length ? data.products : undefined,
        // Filter out failed/empty web results (e.g. "Web search unavailable")
        webResults: data.web_results?.filter(
          (r: WebResult) => r.answer && !r.answer.toLowerCase().includes("unavailable") && !r.answer.toLowerCase().includes("error")
        ).length
          ? data.web_results.filter(
              (r: WebResult) => r.answer && !r.answer.toLowerCase().includes("unavailable") && !r.answer.toLowerCase().includes("error")
            )
          : undefined,
        routeShopIds: data.build_route ? data.route_shop_ids : undefined,
        routeSummary: data.route_summary,
      };

      setMessages((prev) => prev.filter((m) => !m.loading).concat(assistantMsg));
      speak(replyText);

      // Track AI conversation + route trigger
      trackEvent("ai_conversation", {
        userId: user?.id,
        mallId: selectedMall?.id,
        mallName: selectedMall?.name,
        metadata: { has_products: (data.products?.length ?? 0) > 0, budget_set: budget !== null },
      });
      if (data.build_route) {
        trackEvent("ai_route_triggered", {
          userId: user?.id,
          mallId: selectedMall?.id,
          mallName: selectedMall?.name,
          metadata: { stops: data.route_shop_ids?.length ?? 0 },
        });
      }
      if (budget !== null) {
        trackEvent("budget_mode_used", {
          userId: user?.id,
          mallId: selectedMall?.id,
          mallName: selectedMall?.name,
          metadata: { budget },
        });
      }
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
  }, [isLoading, messages, buildHistory, selectedMall, budget, speak, stopSpeech]);

  // Auto-send prefill from shopping list navigation
  useEffect(() => {
    const prefill = (location.state as { prefill?: string } | null)?.prefill;
    if (!prefill || prefillFiredRef.current) return;
    prefillFiredRef.current = true;
    const t = setTimeout(() => sendMessage(prefill), 200);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  function handleSend() {
    unlockTts();
    sendMessage(input);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      unlockTts();
      sendMessage(input);
    }
  }

  function setVoiceErrorAutoDismiss(msg: string) {
    setVoiceError(msg);
    if (voiceErrorTimerRef.current) clearTimeout(voiceErrorTimerRef.current);
    voiceErrorTimerRef.current = setTimeout(() => setVoiceError(null), 4000);
  }

  function startVoice() {
    unlockTts();
    setVoiceError(null);

    if (!speechSupported) {
      setVoiceErrorAutoDismiss("Voice not supported on this browser.");
      return;
    }
    if (!isHttps && window.location.hostname !== "localhost") {
      setVoiceErrorAutoDismiss("Voice requires HTTPS. Type your message instead.");
      return;
    }

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
      // Auto-send after voice input
      setTimeout(() => {
        unlockTts();
        sendMessage(transcript);
      }, 100);
    };
    recognition.onerror = (e: SpeechRecognitionErrorEvent) => {
      setIsListening(false);
      recognitionRef.current = null;
      if (e.error === "not-allowed") {
        setVoiceErrorAutoDismiss("Microphone access denied. Check your browser permissions.");
      } else if (e.error === "network") {
        setVoiceErrorAutoDismiss("Voice requires HTTPS — type your message instead.");
      } else if (e.error !== "aborted") {
        setVoiceErrorAutoDismiss("Voice unavailable — type your message instead.");
      }
    };
    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    try {
      recognitionRef.current = recognition;
      recognition.start();
      setIsListening(true);
    } catch {
      setIsListening(false);
      setVoiceErrorAutoDismiss("Could not start microphone. Try typing instead.");
    }
  }

  function stopVoice() {
    recognitionRef.current?.stop();
    setIsListening(false);
  }

  async function handleBuildRoute(shopIds: string[]) {
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

    const stopIds = sorted.map((s) => s.id);
    setRouteStops(sorted as Shop[]);
    updateSessionRoute(stopIds);
    navigate("/navigate");
  }

  // Navigate to a single shop directly from a recommendation card
  async function handleNavigateToShop(product: ProductResult) {
    const { data } = await supabase
      .from("shops")
      .select("id, mall_id, name, floor, unit_number, category, opening_hours")
      .eq("id", product.shop_id)
      .single();
    if (data) {
      setRouteStops([data as Shop]);
      updateSessionRoute([data.id]);
      trackEvent("navigate_there_clicked", { userId: user?.id, mallId: selectedMall?.id, mallName: selectedMall?.name });
      navigate("/navigate");
    }
  }

  // Add a product to the shopping list
  async function handleAddToList(product: ProductResult) {
    if (!user) return;
    // Get or create default list
    const { data: lists } = await supabase.from("shopping_lists").select("id").eq("user_id", user.id).limit(1).maybeSingle();
    const listId = lists?.id;
    if (!listId) return;
    await supabase.from("shopping_list_items").insert({ list_id: listId, item_name: product.name, checked: false });
  }

  const isEmpty = messages.length === 0;

  return (
    <MobileShell>
      {/* Header */}
      <div className="shrink-0 border-b border-border/50">
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 border border-primary/30 glow-primary">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="font-display font-bold text-sm">MallMind AI</p>
              <p className="text-[10px] text-muted-foreground">
                {selectedMall
                  ? dbSessionId
                    ? `Active session · ${selectedMall.name}`
                    : selectedMall.name
                  : "Select a mall to start"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {ttsSupported && (
              <button
                onClick={() => { if (ttsEnabled) stopSpeech(); setTtsEnabled((v) => !v); }}
                title={ttsEnabled ? "Mute AI voice" : "Unmute AI voice"}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-xl border transition-all",
                  ttsEnabled
                    ? "border-secondary/40 bg-secondary/15 text-secondary"
                    : "border-border bg-surface/60 text-muted-foreground"
                )}
              >
                {ttsEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </button>
            )}
            {selectedMall && (
              <div className="flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs text-primary">
                <MapPin className="h-3 w-3" />
                {selectedMall.city ?? selectedMall.name}
              </div>
            )}
          </div>
        </div>

        {/* Budget bar — shown when budget is set */}
        {budget !== null && (
          <div className="px-5 pb-3 animate-fade-in">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <Wallet className={cn("h-3.5 w-3.5", overBudget ? "text-destructive" : "text-secondary")} />
                <span className={cn("text-xs font-bold", overBudget ? "text-destructive" : "text-secondary")}>
                  {totalCost > 0
                    ? `R${Math.round(totalCost).toLocaleString()} spent`
                    : "Budget set"
                  }
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">
                  {overBudget
                    ? `R${Math.round(totalCost - budget).toLocaleString()} over`
                    : `R${Math.round(budget - totalCost).toLocaleString()} left`
                  } · R{budget.toLocaleString()} budget
                </span>
                <button
                  onClick={() => { setBudget(null); setBudgetInput(""); }}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  overBudget ? "bg-destructive" : "bg-secondary"
                )}
                style={{ width: `${budgetPct}%` }}
              />
            </div>
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
                      "rounded-2xl px-4 py-3",
                      msg.role === "user"
                        ? "rounded-br-sm bg-primary text-primary-foreground text-sm leading-relaxed"
                        : "rounded-bl-sm border border-border bg-surface"
                    )}>
                      {msg.role === "user"
                        ? msg.content
                        : renderMarkdown(msg.content)
                      }
                    </div>
                  )}

                  {msg.products && msg.products.length > 0 && (
                    <div className="space-y-2 w-full max-w-[310px]">
                      <p className="text-[9px] uppercase tracking-wider text-primary/70 px-1 flex items-center gap-1">
                        <Store className="h-3 w-3" /> Live mall prices
                      </p>
                      {msg.products.map((p, i) => (
                        <RecommendationCard
                          key={`${p.product_id}-${i}`}
                          product={p}
                          onNavigate={handleNavigateToShop}
                          onAddToList={user ? handleAddToList : undefined}
                        />
                      ))}
                    </div>
                  )}

                  {msg.webResults && msg.webResults.length > 0 && (
                    <div className="space-y-2 w-full max-w-[300px]">
                      {msg.webResults.map((r, i) => (
                        <WebResultCard key={i} result={r} />
                      ))}
                    </div>
                  )}

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

        {/* Budget input row */}
        {showBudgetInput && (
          <div className="flex items-center gap-2 mb-2 animate-slide-up">
            <div className="flex-1 flex items-center h-10 rounded-2xl border border-secondary/40 bg-secondary/10 overflow-hidden px-3 gap-2">
              <span className="text-sm font-bold text-secondary">R</span>
              <input
                ref={budgetInputRef}
                type="number"
                min="1"
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") confirmBudget(); if (e.key === "Escape") setShowBudgetInput(false); }}
                placeholder="Enter your total budget"
                className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground/60"
              />
            </div>
            <button
              onClick={confirmBudget}
              disabled={!budgetInput}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-secondary/50 bg-secondary/20 text-secondary disabled:opacity-40 transition-all"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              onClick={() => setShowBudgetInput(false)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground transition-all"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Toolbar row: clear + budget chip */}
        {(messages.length > 0 || budget !== null) && !isLoading && (
          <div className="flex items-center justify-between mb-2">
            {messages.length > 0 ? (
              <button
                onClick={() => setMessages([])}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3 w-3" />
                Clear chat
              </button>
            ) : <div />}

            {!showBudgetInput && (
              <button
                onClick={() => {
                  if (budget !== null) { setBudget(null); setBudgetInput(""); }
                  else setShowBudgetInput(true);
                }}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-all",
                  budget !== null
                    ? "border-secondary/40 bg-secondary/10 text-secondary"
                    : "border-border bg-surface/60 text-muted-foreground hover:text-foreground hover:border-secondary/40"
                )}
              >
                <Wallet className="h-3 w-3" />
                {budget !== null ? `R${budget.toLocaleString()} budget ×` : "Set budget"}
              </button>
            )}
          </div>
        )}

        {/* Voice error message */}
        {voiceError && (
          <div className="flex items-center gap-2 px-1 pb-1">
            <MicOff className="h-3.5 w-3.5 text-destructive shrink-0" />
            <p className="text-[11px] text-destructive">{voiceError}</p>
            <button onClick={() => setVoiceError(null)} className="ml-auto text-[10px] text-muted-foreground">✕</button>
          </div>
        )}

        <div className="flex items-center gap-2">
          {speechSupported && (
            <button
              onClick={isListening ? stopVoice : startVoice}
              title={!isHttps && window.location.hostname !== "localhost" ? "Voice requires HTTPS" : undefined}
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-all",
                isListening
                  ? "border-secondary/50 bg-secondary/15 text-secondary glow-secondary animate-pulse"
                  : voiceError
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
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
            placeholder={isListening ? "Listening…" : budget ? `Ask within R${budget.toLocaleString()} budget…` : "Ask about any product…"}
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
