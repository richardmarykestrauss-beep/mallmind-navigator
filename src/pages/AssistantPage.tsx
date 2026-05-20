import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Mic, MicOff, Send, Bot, User, Route as RouteIcon,
  Store, Sparkles, MapPin, Loader2, ShoppingBag, X, Globe,
  Volume2, VolumeX, Wallet, ChevronRight, AlertTriangle, Navigation,
  ThumbsUp, ThumbsDown,
} from "lucide-react";
import MobileShell from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import RecommendationCard, { type ProductResult } from "@/components/RecommendationCard";
import { supabase } from "@/lib/supabaseClient";
import { useShoppingSession } from "@/context/ShoppingSessionContext";
import { useAuth } from "@/context/AuthContext";
import { useGeoLocation } from "@/context/LocationContext";
import { trackEvent } from "@/lib/analytics";
import { trackBackendEvent } from "@/lib/analyticsClient";
import { cn } from "@/lib/utils";
import type { Shop } from "@/lib/supabaseClient";
import {
  isGoogleBackendConfigured,
  sendAssistantMessage as googleSendAssistantMessage,
  reportPriceCorrection,
  type WebResult,
  type AssistantResponse,
} from "@/lib/googleBackendClient";

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/env";

// ProductResult imported from RecommendationCard component
// WebResult and AssistantResponse imported from googleBackendClient

import type { RouteStep } from "@/context/ShoppingSessionContext";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  products?: ProductResult[];
  webResults?: WebResult[];
  routeShopIds?: string[];
  routeSummary?: string;
  routeSteps?: RouteStep[];
  routeId?: string | null;
  loading?: boolean;
  /** Context-aware text shown below the thinking dots while loading */
  loadingText?: string;
}

// ── Intent detection for loading copy ────────────────────────────────────────
const ROUTE_INTENT_RE = /\b(take me to|directions?\s+to|route\s+to|navigate\s+to|show me the way|how do i get)\b/i;
const PRICE_INTENT_RE = /\b(tv|screen|laptop|phone|sneaker|deal|cheap|cheapest|under\s*r?\d+|price|compare|specials?)\b/i;

function getLoadingText(userMessage: string): string {
  if (ROUTE_INTENT_RE.test(userMessage)) return "Building your route…";
  if (PRICE_INTENT_RE.test(userMessage)) return "Checking verified prices…";
  return "MallMind is thinking…";
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

// ── Thinking state ────────────────────────────────────────────────────────────
// Shows animated dots + optional context line ("Building your route…" etc.)
function InlineThinkingState({ text }: { text?: string }) {
  return (
    <div className="flex items-end gap-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-primary/15 border border-primary/20">
        <Bot className="h-3.5 w-3.5 text-primary" />
      </div>
      <div className="rounded-2xl rounded-bl-sm border border-border bg-surface px-4 py-3 space-y-1.5">
        {text && (
          <p className="text-[11px] text-muted-foreground/80 italic">{text}</p>
        )}
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

// ── Feedback strip ────────────────────────────────────────────────────────────
// Tiny, optional feedback row. Mobile-first, non-blocking, non-intrusive.

interface FeedbackOption {
  label: string;
  value: string;
  icon?: React.ReactNode;
}

function FeedbackStrip({
  question,
  options,
  done,
  doneMessage = "Thanks for the feedback",
  onSelect,
}: {
  question: string;
  options: FeedbackOption[];
  done: boolean;
  doneMessage?: string;
  onSelect: (value: string) => void;
}) {
  if (done) {
    return (
      <p className="text-[10px] text-muted-foreground/55 italic px-1">
        ✓ {doneMessage}
      </p>
    );
  }
  return (
    <div className="flex items-center gap-1.5 px-1 flex-wrap">
      <span className="text-[10px] text-muted-foreground/70 shrink-0">{question}</span>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onSelect(opt.value)}
          className="flex items-center gap-1 rounded-full border border-border/60 bg-background px-2 py-0.5 text-[10px] text-muted-foreground hover:border-primary/50 hover:text-foreground active:scale-95 transition-all"
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── Price correction form ─────────────────────────────────────────────────────
// Inline compact form — shown when user taps "Price wrong?".
// Sends a report to the backend; never directly updates products.

const CORRECTION_SOURCES = [
  { value: "in_store_seen",    label: "Saw in-store" },
  { value: "retailer_website", label: "Retailer website" },
  { value: "catalogue",        label: "Catalogue / flyer" },
  { value: "other",            label: "Not sure / other" },
];

function PriceCorrectionForm({
  product,
  mallId,
  sessionId,
  onClose,
  onSubmitted,
}: {
  product: ProductResult;
  mallId: string | null;
  sessionId: string | null;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [reportedPrice, setReportedPrice] = useState("");
  const [sourceType,    setSourceType]    = useState("in_store_seen");
  const [note,          setNote]          = useState("");
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState<string | null>(null);

  async function handleSubmit() {
    const price = parseFloat(reportedPrice.replace(/[^0-9.]/g, ""));
    if (isNaN(price) || price <= 0) {
      setError("Please enter a valid price.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await reportPriceCorrection({
        product_id:    product.product_id,
        shop_id:       product.shop_id ?? null,
        mall_id:       mallId,
        current_price: product.price,
        reported_price: price,
        user_note:     note.trim() || null,
        source_type:   sourceType,
        metadata: {
          product_name:        product.name,
          shop_name:           product.shop_name,
          data_quality_status: product.data_quality_status ?? null,
          price_verified_at:   product.price_verified_at ?? null,
          session_id:          sessionId,
        },
      });
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit — try again.");
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-foreground">Report incorrect price</p>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Current price reference */}
      <p className="text-[10px] text-muted-foreground/80">
        Currently showing: <span className="font-semibold text-foreground">R{product.price.toFixed(0)}</span>
      </p>

      <div className="space-y-2">
        {/* Reported price */}
        <div>
          <label className="text-[10px] text-muted-foreground">Correct price (R)</label>
          <input
            type="number"
            min="1"
            value={reportedPrice}
            onChange={(e) => setReportedPrice(e.target.value)}
            placeholder="e.g. 3599"
            className="mt-0.5 w-full h-8 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:border-primary/50 transition-all"
          />
        </div>

        {/* Source */}
        <div>
          <label className="text-[10px] text-muted-foreground">Where did you see this price?</label>
          <select
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value)}
            className="mt-0.5 w-full h-8 rounded-lg border border-border bg-background px-2.5 text-sm focus:outline-none transition-all"
          >
            {CORRECTION_SOURCES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        {/* Optional note */}
        <div>
          <label className="text-[10px] text-muted-foreground">Note (optional)</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 500))}
            placeholder="Any extra context…"
            className="mt-0.5 w-full h-8 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:border-primary/50 transition-all"
          />
        </div>
      </div>

      {error && (
        <p className="text-[10px] text-destructive flex items-center gap-1">
          <AlertTriangle className="h-3 w-3 shrink-0" />{error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={!reportedPrice || loading}
          className="flex-1 h-8 rounded-lg bg-amber-500 text-white text-xs font-semibold disabled:opacity-40 hover:bg-amber-600 active:scale-[0.98] transition-all"
        >
          {loading ? "Submitting…" : "Submit report"}
        </button>
        <button
          onClick={onClose}
          className="h-8 px-3 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-all"
        >
          Cancel
        </button>
      </div>

      <p className="text-[9px] text-muted-foreground/50 leading-relaxed">
        Your report will be reviewed before any price change. We never update prices automatically.
      </p>
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
  const { selectedMall, setRouteStops, dbSessionId, shoppingIntent, updateSessionRoute, setActiveRoute } = useShoppingSession();
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

  // ── Feedback state ─────────────────────────────────────────────────────────
  // Map of feedbackKey → done-message string. Key format:
  //   "${msgId}:recommendation"  "${msgId}:price:${productId}"
  //   "${msgId}:route"           "${msgId}:purchase"
  const [feedbackGiven, setFeedbackGiven] = useState<Record<string, string>>({});

  // ── Price correction state ─────────────────────────────────────────────────
  // correctionOpenId: product_id (or fallback index string) of the open form.
  // correctionDoneIds: set of product ids that have had a report submitted.
  const [correctionOpenId,  setCorrectionOpenId]  = useState<string | null>(null);
  const [correctionDoneIds, setCorrectionDoneIds] = useState<Set<string>>(new Set());

  const markFeedback = useCallback((key: string, message = "Thanks for the feedback") => {
    setFeedbackGiven((prev) => ({ ...prev, [key]: message }));
  }, []);

  const handleFeedback = useCallback((
    key: string,
    eventType: "recommendation_feedback" | "price_accuracy_feedback" | "route_feedback" | "purchase_signal",
    value: string,
    product?: ProductResult,
    routeData?: { routeShopIds: string[]; routeSummary?: string; routeSteps?: RouteStep[]; routeId?: string | null }
  ) => {
    const doneMsg =
      eventType === "price_accuracy_feedback" && value === "incorrect"
        ? "Thanks — we'll flag this for review."
        : "Thanks for the feedback";
    markFeedback(key, doneMsg);

    const mallId = selectedMall?.id ? String(selectedMall.id) : null;
    const sessionId = dbSessionId ?? null;

    if (eventType === "recommendation_feedback") {
      trackBackendEvent({
        event_type: "recommendation_feedback",
        product_id: product?.product_id ?? null,
        shop_id:    product?.shop_id ?? null,
        mall_id: mallId, session_id: sessionId,
        metadata: {
          value,
          product_name:        product?.name ?? null,
          shop_name:           product?.shop_name ?? null,
          data_quality_status: product?.data_quality_status ?? null,
          response_type: "product_recommendation",
        },
      });
    } else if (eventType === "price_accuracy_feedback") {
      trackBackendEvent({
        event_type: "price_accuracy_feedback",
        product_id: product?.product_id ?? null,
        shop_id:    product?.shop_id ?? null,
        mall_id: mallId, session_id: sessionId,
        metadata: {
          value,
          product_name:               product?.name ?? null,
          shop_name:                  product?.shop_name ?? null,
          shown_price:                product?.price ?? null,
          data_quality_status:        product?.data_quality_status ?? null,
          price_verification_method:  product?.price_verification_method ?? null,
          price_verified_at:          product?.price_verified_at ?? null,
        },
      });
    } else if (eventType === "route_feedback") {
      trackBackendEvent({
        event_type: "route_feedback",
        shop_id:   routeData?.routeShopIds?.[0] ?? null,
        route_id:  routeData?.routeId ?? null,
        mall_id: mallId, session_id: sessionId,
        metadata: {
          value,
          route_summary:    routeData?.routeSummary ?? null,
          route_step_count: routeData?.routeSteps?.length ?? 0,
          route_shop_ids:   routeData?.routeShopIds ?? [],
        },
      });
    } else if (eventType === "purchase_signal") {
      trackBackendEvent({
        event_type: "purchase_signal",
        product_id: product?.product_id ?? null,
        shop_id:    product?.shop_id ?? (routeData?.routeShopIds?.[0] ?? null),
        mall_id: mallId, session_id: sessionId,
        metadata: {
          value,
          product_name:        product?.name ?? null,
          shop_name:           product?.shop_name ?? null,
          price:               product?.price ?? null,
          data_quality_status: product?.data_quality_status ?? null,
        },
      });
    }
  }, [markFeedback, selectedMall, dbSessionId]);

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
      loadingText: getLoadingText(text.trim()),
    };

    stopSpeech();
    setMessages((prev) => [...prev, userMsg, loadingMsg]);
    setInput("");
    setIsLoading(true);

    // ── Event 1: assistant_query_submitted ────────────────────────────────────
    trackBackendEvent({
      event_type: "assistant_query_submitted",
      query_text: text.trim(),
      mall_id: selectedMall?.id ? String(selectedMall.id) : null,
      session_id: dbSessionId ?? null,
      metadata: { source: "assistant" },
    });

    try {
      const history = buildHistory([...messages, userMsg]);

      let data: AssistantResponse;

      if (isGoogleBackendConfigured()) {
        // ── Google Cloud Run backend ─────────────────────────────────────────
        // /assistant calls recommend_products, build_route, and check_store_hours
        // server-side via Gemini function calling — no extra client requests needed.
        data = await googleSendAssistantMessage({
          messages:        history,
          mall_id:         selectedMall?.id ? String(selectedMall.id) : null,
          mall_name:       selectedMall?.name ?? null,
          budget:          budget ?? undefined,
          user_id:         user?.id ?? null,
          session_id:      dbSessionId ?? null,
          current_lat:     position?.lat ?? null,
          current_lng:     position?.lng ?? null,
          shopping_intent: shoppingIntent ?? null,
        });
      } else {
        // ── Supabase Edge Function (existing path) ───────────────────────────
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
        data = (await res.json()) as AssistantResponse;
      }

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
        routeSteps: data.route_steps?.length ? data.route_steps : undefined,
        routeId: data.route_id ?? null,
      };

      setMessages((prev) => prev.filter((m) => !m.loading).concat(assistantMsg));
      speak(replyText);

      // ── Event 2: assistant_response_received ──────────────────────────────
      trackBackendEvent({
        event_type: "assistant_response_received",
        mall_id: selectedMall?.id ? String(selectedMall.id) : null,
        session_id: dbSessionId ?? null,
        metadata: {
          product_count: data.products?.length ?? 0,
          build_route: data.build_route ?? false,
          route_step_count: data.route_steps?.length ?? 0,
          top_product_id: data.products?.[0]?.product_id ?? null,
          top_shop_id: data.products?.[0]?.shop_id ?? null,
          top_data_quality_status: data.products?.[0]?.data_quality_status ?? null,
        },
      });

      // ── Event 3: product_recommendation_viewed (best pick / top result) ───
      if (data.products?.[0]) {
        const top = data.products[0];
        trackBackendEvent({
          event_type: "product_recommendation_viewed",
          product_id: top.product_id ?? null,
          shop_id: top.shop_id ?? null,
          mall_id: selectedMall?.id ? String(selectedMall.id) : null,
          session_id: dbSessionId ?? null,
          metadata: {
            product_name: top.name,
            shop_name: top.shop_name,
            price: top.price,
            data_quality_status: top.data_quality_status ?? null,
            is_best_pick: true,
          },
        });
      }

      // ── Event 5: route_response_received ──────────────────────────────────
      if (data.build_route) {
        trackBackendEvent({
          event_type: "route_response_received",
          mall_id: selectedMall?.id ? String(selectedMall.id) : null,
          session_id: dbSessionId ?? null,
          route_id: data.route_id ?? null,
          metadata: {
            route_summary: data.route_summary ?? null,
            route_step_count: data.route_steps?.length ?? 0,
            route_shop_ids: data.route_shop_ids ?? [],
          },
        });
      }

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

  // Handle "Start Navigation" from route card — uses real steps if available
  async function handleBuildRoute(shopIds: string[], steps?: RouteStep[], routeId?: string | null) {
    // If AI already built the real route, use it directly
    if (steps?.length && routeId) {
      setActiveRoute(routeId, steps);
      navigate("/navigate");
      return;
    }

    // Fallback: load shops and sort by floor for stop-list mode
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
    updateSessionRoute(sorted.map((s) => s.id));
    navigate("/navigate");
  }

  // ── Event 4: route_requested — fired when user taps "Take me to [shop]" ────
  function handleTakeMeTo(product: ProductResult, queryText: string) {
    trackBackendEvent({
      event_type: "route_requested",
      shop_id: product.shop_id ?? null,
      product_id: product.product_id ?? null,
      mall_id: selectedMall?.id ? String(selectedMall.id) : null,
      session_id: dbSessionId ?? null,
      query_text: queryText,
    });
    sendMessage(queryText);
  }

  // Navigate to a single shop from a recommendation card
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
      <div className="shrink-0 border-b border-border/50 bg-background/60 backdrop-blur-xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 border border-primary/30 glow-primary">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="font-display font-bold text-sm">MallMind AI</p>
              <div className="flex items-center gap-1.5">
                {dbSessionId && (
                  <span className="h-1.5 w-1.5 rounded-full bg-secondary animate-pulse shrink-0" />
                )}
                <p className="text-[10px] text-muted-foreground">
                  {selectedMall
                    ? dbSessionId
                      ? `Active session · ${selectedMall.name}`
                      : selectedMall.name
                    : "Select a mall to start"}
                </p>
              </div>
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
              <p className="font-display font-semibold text-lg">Hey, I'm MallMind AI</p>
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
            <div className="w-full">
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground px-1 mb-3">
                Try asking
              </p>
              {/* Horizontal scrolling chip row */}
              <div
                className="overflow-x-auto -mx-4 px-4 pb-1"
                style={{ scrollbarWidth: "none", msOverflowStyle: "none" } as React.CSSProperties}
              >
                <div className="flex gap-2 w-max">
                  {STARTERS.map((s) => (
                    <button
                      key={s}
                      onClick={() => sendMessage(s)}
                      className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/8 px-4 py-2 text-xs font-medium text-primary/90 hover:bg-primary/15 hover:border-primary/50 hover:shadow-[0_0_12px_hsl(190_100%_50%/0.2)] whitespace-nowrap transition-all active:scale-95 shrink-0"
                    >
                      <Sparkles className="h-3 w-3 shrink-0 text-primary/70" />
                      {s}
                    </button>
                  ))}
                </div>
              </div>
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
                <InlineThinkingState text={msg.loadingText} />
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

                      {/* Cards — each wrapped with price-accuracy feedback */}
                      {msg.products.map((p, i) => {
                        const priceKey = `${msg.id}:price:${p.product_id ?? i}`;
                        return (
                          <div key={`${p.product_id}-${i}`} className="space-y-1">
                            <RecommendationCard
                              product={p}
                              isBestPick={i === 0}
                              onNavigate={handleNavigateToShop}
                              onAddToList={user ? handleAddToList : undefined}
                            />
                            {/* Part 2: Price accuracy feedback */}
                            <FeedbackStrip
                              question="Was this price correct?"
                              options={[
                                { label: "Yes", value: "correct" },
                                { label: "No",  value: "incorrect" },
                              ]}
                              done={priceKey in feedbackGiven}
                              doneMessage={feedbackGiven[priceKey]}
                              onSelect={(value) => handleFeedback(priceKey, "price_accuracy_feedback", value, p)}
                            />

                            {/* Part 2b: Price correction — "Price wrong?" trigger / inline form / done */}
                            {(() => {
                              const corrKey = p.product_id ?? String(i);
                              if (correctionDoneIds.has(corrKey)) {
                                return (
                                  <p className="text-[10px] text-muted-foreground/55 italic px-1">
                                    ✓ Price report submitted — thanks!
                                  </p>
                                );
                              }
                              if (correctionOpenId === corrKey) {
                                return (
                                  <PriceCorrectionForm
                                    product={p}
                                    mallId={selectedMall?.id ? String(selectedMall.id) : null}
                                    sessionId={dbSessionId ?? null}
                                    onClose={() => setCorrectionOpenId(null)}
                                    onSubmitted={() => {
                                      setCorrectionDoneIds((prev) => new Set([...prev, corrKey]));
                                      setCorrectionOpenId(null);
                                    }}
                                  />
                                );
                              }
                              return (
                                <button
                                  onClick={() => setCorrectionOpenId(corrKey)}
                                  className="text-[10px] text-amber-500/70 hover:text-amber-500 transition-colors px-1 underline underline-offset-2"
                                >
                                  Price wrong?
                                </button>
                              );
                            })()}
                          </div>
                        );
                      })}

                      {/* Trust warning — disputed / expired / needs review */}
                      {msg.products[0]?.display_warning && (
                        <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-600">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          {msg.products[0].display_warning}
                        </div>
                      )}

                      {/* Closed-shop warning */}
                      {msg.products[0]?.is_open_now === false && (
                        <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-600">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          Store may be closed right now — confirm trading hours.
                        </div>
                      )}

                      {/* Take me to button — only when route not yet built */}
                      {!msg.routeShopIds?.length && (
                        <button
                          onClick={() => {
                            const queryText = `Take me to ${msg.products![0].shop_name} for the ${msg.products![0].name}`;
                            handleTakeMeTo(msg.products![0], queryText);
                          }}
                          disabled={isLoading}
                          className={cn(
                            "w-full flex items-center justify-center gap-2 h-9 rounded-xl border text-xs font-semibold transition-all",
                            isLoading
                              ? "border-border bg-surface/60 text-muted-foreground cursor-not-allowed"
                              : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
                          )}
                        >
                          {isLoading
                            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Building route…</>
                            : <><Navigation className="h-3.5 w-3.5" /> Take me to {msg.products![0].shop_name}</>
                          }
                        </button>
                      )}

                      {/* Route built indicator */}
                      {msg.routeShopIds && msg.routeShopIds.length > 0 && (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/8 border border-primary/25 text-[11px] text-primary font-medium">
                          <RouteIcon className="h-3.5 w-3.5 shrink-0" />
                          Route ready · follow the steps below
                        </div>
                      )}

                      {/* Part 1: Recommendation feedback */}
                      <FeedbackStrip
                        question="Was this helpful?"
                        options={[
                          { label: "Useful",     value: "useful",     icon: <ThumbsUp   className="h-3 w-3" /> },
                          { label: "Not useful", value: "not_useful", icon: <ThumbsDown className="h-3 w-3" /> },
                        ]}
                        done={`${msg.id}:recommendation` in feedbackGiven}
                        doneMessage={feedbackGiven[`${msg.id}:recommendation`]}
                        onSelect={(value) => handleFeedback(`${msg.id}:recommendation`, "recommendation_feedback", value, msg.products![0])}
                      />

                      {/* Part 4: Purchase signal — only when no route (route block handles it when route exists) */}
                      {!msg.routeShopIds?.length && (
                        <FeedbackStrip
                          question="Did you buy it?"
                          options={[
                            { label: "Bought it", value: "bought"    },
                            { label: "Not today", value: "not_today" },
                          ]}
                          done={`${msg.id}:purchase` in feedbackGiven}
                          doneMessage={feedbackGiven[`${msg.id}:purchase`]}
                          onSelect={(value) => handleFeedback(`${msg.id}:purchase`, "purchase_signal", value, msg.products![0])}
                        />
                      )}
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
                    <div className={cn(
                      "rounded-2xl border p-3 space-y-2.5 w-full max-w-[310px]",
                      msg.routeSteps?.length
                        ? "border-primary/50 bg-primary/10"
                        : "border-primary/30 bg-primary/8"
                    )}>
                      {/* Route header */}
                      <div className="flex items-center gap-2">
                        <RouteIcon className="h-4 w-4 text-primary shrink-0" />
                        <p className="text-xs font-semibold text-primary">
                          {msg.routeSummary || (msg.routeSteps?.length
                            ? `${msg.routeSteps.length} steps`
                            : `${msg.routeShopIds.length} stop${msg.routeShopIds.length !== 1 ? "s" : ""}`)}
                        </p>
                      </div>

                      {/* Step-by-step directions */}
                      {msg.routeSteps && msg.routeSteps.length > 0 && (
                        <div className="space-y-2 pl-1">
                          {msg.routeSteps.map((step) => (
                            <div key={step.step} className="flex items-start gap-2.5">
                              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/20 border border-primary/30 text-[10px] font-bold text-primary mt-0.5">
                                {step.step}
                              </span>
                              <div className="min-w-0">
                                <p className="text-[11px] text-foreground leading-snug">{step.instruction}</p>
                                {step.floor && (
                                  <p className="text-[9px] text-muted-foreground mt-0.5">Floor {step.floor}</p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Start navigation CTA */}
                      <Button
                        variant="neon"
                        size="sm"
                        className="w-full"
                        onClick={() => handleBuildRoute(msg.routeShopIds!, msg.routeSteps, msg.routeId)}
                      >
                        <RouteIcon className="h-4 w-4" />
                        Start Navigation
                      </Button>

                      {/* Part 3: Route success feedback */}
                      <FeedbackStrip
                        question="Did you find the store?"
                        options={[
                          { label: "Yes", value: "found_store"        },
                          { label: "No",  value: "did_not_find_store" },
                        ]}
                        done={`${msg.id}:route` in feedbackGiven}
                        doneMessage={feedbackGiven[`${msg.id}:route`]}
                        onSelect={(value) => handleFeedback(
                          `${msg.id}:route`,
                          "route_feedback",
                          value,
                          undefined,
                          {
                            routeShopIds: msg.routeShopIds!,
                            routeSummary: msg.routeSummary,
                            routeSteps:   msg.routeSteps,
                            routeId:      msg.routeId,
                          }
                        )}
                      />

                      {/* Part 4: Purchase signal (route context) */}
                      <FeedbackStrip
                        question="Did you buy it?"
                        options={[
                          { label: "Bought it", value: "bought"    },
                          { label: "Not today", value: "not_today" },
                        ]}
                        done={`${msg.id}:purchase` in feedbackGiven}
                        doneMessage={feedbackGiven[`${msg.id}:purchase`]}
                        onSelect={(value) => handleFeedback(
                          `${msg.id}:purchase`,
                          "purchase_signal",
                          value,
                          msg.products?.[0],
                          { routeShopIds: msg.routeShopIds! }
                        )}
                      />
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
      <div className="shrink-0 px-4 pb-24 pt-2 border-t border-border/50 bg-background/90 backdrop-blur-xl">

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
                onClick={() => {
                  setMessages([]);
                  setCorrectionOpenId(null);
                  setCorrectionDoneIds(new Set());
                }}
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
