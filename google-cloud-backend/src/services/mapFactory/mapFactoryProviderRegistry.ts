/**
 * mapFactoryProviderRegistry.ts — Sprint 16
 *
 * Central registry that answers three questions:
 *   1. Which providers are configured right now? (getProviderStatus)
 *   2. In what order should we try extraction providers? (getExtractionProviderChain)
 *   3. Which single provider is selected by env var? (getActiveExtractionProvider)
 *
 * Provider names (stable string identifiers):
 *   "mock"                       — always available, deterministic test data
 *   "gemini_vision_extraction"   — Gemini 1.5 Flash image analysis
 *   "google_vision_ocr"          — Google Vision API text detection
 *   "google_document_ai_layout"  — Document AI (skeleton, requires OAuth)
 *   "gemini_embedding"           — Gemini text-embedding (not an extraction provider)
 */

import {
  isGeminiConfigured,
  isVisionConfigured,
  isDocumentAiConfigured,
} from "./googleAiProviderService.js";

// ── Status ────────────────────────────────────────────────────────────────────

export interface ProviderStatusMap {
  mock:                       boolean;  // always true
  gemini_vision_extraction:   boolean;
  google_vision_ocr:          boolean;
  google_document_ai_layout:  boolean;
  gemini_embedding:           boolean;
}

/**
 * Return the configured status for every provider.
 * Safe to call at any time — does not expose secrets.
 */
export function getProviderStatus(): ProviderStatusMap {
  return {
    mock:                       true,
    gemini_vision_extraction:   isGeminiConfigured(),
    google_vision_ocr:          isVisionConfigured(),
    google_document_ai_layout:  isDocumentAiConfigured(),
    gemini_embedding:           isGeminiConfigured(),
  };
}

// ── Provider chain ────────────────────────────────────────────────────────────

/**
 * Ordered list of extraction provider names to try for a given MIME type.
 * The chain always ends with "mock" as the unconditional fallback.
 *
 * Chain order:
 *   1. gemini_vision_extraction (if configured)
 *   2. google_vision_ocr        (if configured — images only)
 *   3. mock
 */
export function getExtractionProviderChain(mimeType?: string): string[] {
  const chain: string[] = [];

  const status = getProviderStatus();

  // Gemini works on images and PDFs
  if (status.gemini_vision_extraction) {
    chain.push("gemini_vision_extraction");
  }

  // Vision OCR — images only (not PDF)
  const isImage = !mimeType || mimeType.startsWith("image/");
  if (status.google_vision_ocr && isImage) {
    chain.push("google_vision_ocr");
  }

  // Document AI — skeleton, currently always not_configured
  if (status.google_document_ai_layout) {
    chain.push("google_document_ai_layout");
  }

  // Mock is the unconditional terminal fallback
  chain.push("mock");

  return chain;
}

// ── Active provider ───────────────────────────────────────────────────────────

/**
 * Return the single provider name selected by MAP_FACTORY_AI_PROVIDER.
 * Falls back to "mock" if the env var is unset or points to an unconfigured provider.
 */
export function getActiveExtractionProvider(): string {
  const requested = (process.env.MAP_FACTORY_AI_PROVIDER ?? "mock").toLowerCase().trim();

  const status = getProviderStatus();
  const statusMap: Record<string, boolean> = status as unknown as Record<string, boolean>;

  // "mock" is always available
  if (requested === "mock") return "mock";

  // Check whether the requested provider is actually configured
  if (statusMap[requested] === true) return requested;

  // Requested provider not configured — emit a warning and fall back to mock
  console.warn(
    `[mapFactoryProviderRegistry] MAP_FACTORY_AI_PROVIDER="${requested}" is not configured; ` +
    `falling back to "mock". Set MAP_FACTORY_ENABLE_GOOGLE_AI=true and the required API key to enable.`,
  );
  return "mock";
}
