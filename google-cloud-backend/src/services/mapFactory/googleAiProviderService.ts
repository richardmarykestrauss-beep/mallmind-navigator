/**
 * googleAiProviderService.ts — Sprint 16
 *
 * Four thin wrapper functions that call Google AI APIs when the relevant
 * environment variables are present.  Every function:
 *   • Returns a structured "not_configured" result when env vars are missing —
 *     never throws due to missing configuration.
 *   • Only activates when MAP_FACTORY_ENABLE_GOOGLE_AI=true (explicit opt-in).
 *   • Never logs API keys or secrets.
 *
 * Providers:
 *   runVisionOcr()           — Google Vision OCR (GOOGLE_CLOUD_VISION_API_KEY)
 *   runDocumentAiLayout()    — Document AI layout (GOOGLE_CLOUD_PROJECT +
 *                              GOOGLE_DOCUMENT_AI_PROCESSOR_ID) — skeleton only
 *   runGeminiVisionExtraction() — Gemini 1.5 Flash vision (GEMINI_API_KEY)
 *   runGeminiEmbedding()     — Gemini text-embedding (GEMINI_API_KEY)
 *
 * Config helpers (used by mapFactoryProviderRegistry.ts):
 *   isVisionConfigured()
 *   isDocumentAiConfigured()
 *   isGeminiConfigured()
 *   isGoogleAiEnabled()
 */

import type { DetectedAnchor, DetectedCorridor } from "../mapImageExtractionService.js";

// ── Config helpers ────────────────────────────────────────────────────────────

/** Returns true only when MAP_FACTORY_ENABLE_GOOGLE_AI=true is explicitly set. */
export function isGoogleAiEnabled(): boolean {
  return process.env.MAP_FACTORY_ENABLE_GOOGLE_AI === "true";
}

export function isVisionConfigured(): boolean {
  return isGoogleAiEnabled() && !!process.env.GOOGLE_CLOUD_VISION_API_KEY;
}

export function isDocumentAiConfigured(): boolean {
  return (
    isGoogleAiEnabled() &&
    !!process.env.GOOGLE_CLOUD_PROJECT &&
    !!process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID
  );
}

export function isGeminiConfigured(): boolean {
  return isGoogleAiEnabled() && !!process.env.GEMINI_API_KEY;
}

// ── Shared result types ───────────────────────────────────────────────────────

export type ProviderStatus = "ok" | "not_configured" | "error";

export interface ProviderResult<T = unknown> {
  status:   ProviderStatus;
  provider: string;
  data?:    T;
  error?:   string;
}

// ── 1. Google Vision OCR ──────────────────────────────────────────────────────

export interface VisionOcrResult {
  full_text:  string;
  text_blocks: Array<{ text: string; confidence: number }>;
}

/**
 * Send an image URL to the Google Vision API for OCR.
 * Returns not_configured when the API key is absent or Google AI is disabled.
 */
export async function runVisionOcr(
  imageUrl: string,
): Promise<ProviderResult<VisionOcrResult>> {
  if (!isVisionConfigured()) {
    return { status: "not_configured", provider: "google_vision_ocr" };
  }

  const apiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY!;

  try {
    const body = {
      requests: [
        {
          image:    { source: { imageUri: imageUrl } },
          features: [{ type: "TEXT_DETECTION" }],
        },
      ],
    };

    const resp = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      },
    );

    if (!resp.ok) {
      const errText = await resp.text();
      return {
        status:   "error",
        provider: "google_vision_ocr",
        error:    `Vision API ${resp.status}: ${errText.slice(0, 200)}`,
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await resp.json();
    const annotation = json?.responses?.[0]?.fullTextAnnotation;
    const fullText: string = annotation?.text ?? "";

    // Extract individual text blocks
    const pages = annotation?.pages ?? [];
    const textBlocks: Array<{ text: string; confidence: number }> = [];
    for (const page of pages) {
      for (const block of (page.blocks ?? [])) {
        const blockText: string = (block.paragraphs ?? [])
          .flatMap((p: { words?: Array<{ symbols?: Array<{ text?: string }> }> }) =>
            (p.words ?? []).map((w) =>
              (w.symbols ?? []).map((s) => s.text ?? "").join("")
            )
          )
          .join(" ");
        if (blockText.trim()) {
          textBlocks.push({
            text:       blockText.trim(),
            confidence: block.confidence ?? 0,
          });
        }
      }
    }

    return {
      status:   "ok",
      provider: "google_vision_ocr",
      data:     { full_text: fullText, text_blocks: textBlocks },
    };
  } catch (err) {
    return {
      status:   "error",
      provider: "google_vision_ocr",
      error:    String(err),
    };
  }
}

// ── 2. Document AI Layout ─────────────────────────────────────────────────────
//
// Document AI requires OAuth 2.0 (service account) — not a simple API key.
// Implementing the full OAuth flow depends on `google-auth-library` which is not
// currently installed in this backend.  This function is a skeleton that returns
// "not_configured" so the rest of the provider chain can fall through gracefully.
// When Document AI is needed, install `google-auth-library` and replace the body.

export interface DocumentAiLayoutResult {
  pages:   number;
  entities: Array<{ type: string; text: string; confidence: number }>;
}

export async function runDocumentAiLayout(
  _documentUrl: string,
): Promise<ProviderResult<DocumentAiLayoutResult>> {
  if (!isDocumentAiConfigured()) {
    return { status: "not_configured", provider: "google_document_ai_layout" };
  }

  // Skeleton — OAuth implementation requires google-auth-library
  return {
    status:   "not_configured",
    provider: "google_document_ai_layout",
    error:    "Document AI OAuth not yet implemented — install google-auth-library to enable",
  };
}

// ── 3. Gemini Vision Extraction ───────────────────────────────────────────────

const GEMINI_EXTRACTION_PROMPT = `
You are a precise mall floor plan analyser.
Inspect the provided floor plan image and return ONLY a valid JSON object with this exact structure — no prose, no markdown:

{
  "detected_anchors": [
    {
      "label": "<store/entrance/parking name>",
      "anchor_type": "<shop|entrance|parking|corridor_node|landmark|stairs|emergency_exit|info_desk>",
      "raw_text": "<text exactly as it appears on the image>",
      "x_percent": <0-100 float>,
      "y_percent": <0-100 float>,
      "confidence_score": <0.0-1.0 float>
    }
  ],
  "detected_corridors": [
    {
      "label": "<corridor hub label>",
      "x_percent": <0-100 float>,
      "y_percent": <0-100 float>,
      "confidence_score": <0.0-1.0 float>
    }
  ],
  "floor_label": "<floor name as written on the image>"
}

Rules:
- x_percent / y_percent are the position of the item as a percentage of image width/height (0,0 = top-left).
- anchor_type MUST be one of the listed enum values.
- confidence_score reflects your certainty (1.0 = certain).
- Return an empty array for detected_anchors or detected_corridors if none found.
- floor_label should be the floor name from the image, or null if not visible.
`.trim();

export interface GeminiExtractionResult {
  detected_anchors:   DetectedAnchor[];
  detected_corridors: DetectedCorridor[];
  floor_label:        string | null;
  raw_response?:      string;
}

/**
 * Call Gemini 1.5 Flash with an image URL for anchor + corridor extraction.
 * Returns not_configured when the API key is absent or Google AI is disabled.
 */
export async function runGeminiVisionExtraction(
  imageUrl: string,
  floorLabel: string,
): Promise<ProviderResult<GeminiExtractionResult>> {
  if (!isGeminiConfigured()) {
    return { status: "not_configured", provider: "gemini_vision_extraction" };
  }

  const apiKey = process.env.GEMINI_API_KEY!;

  try {
    const requestBody = {
      contents: [
        {
          parts: [
            { text: GEMINI_EXTRACTION_PROMPT },
            { text: `Floor label context: ${floorLabel}` },
            { inline_data: { mime_type: "image/jpeg", data: await fetchImageAsBase64(imageUrl) } },
          ],
        },
      ],
      generationConfig: {
        temperature:     0,
        responseMimeType: "application/json",
      },
    };

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(requestBody),
      },
    );

    if (!resp.ok) {
      const errText = await resp.text();
      return {
        status:   "error",
        provider: "gemini_vision_extraction",
        error:    `Gemini API ${resp.status}: ${errText.slice(0, 300)}`,
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await resp.json();
    const rawText: string = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    let parsed: GeminiExtractionResult;
    try {
      const obj = JSON.parse(rawText);
      parsed = {
        detected_anchors:   Array.isArray(obj.detected_anchors)   ? obj.detected_anchors   : [],
        detected_corridors: Array.isArray(obj.detected_corridors) ? obj.detected_corridors : [],
        floor_label:        obj.floor_label ?? null,
        raw_response:       rawText,
      };

      // Normalise anchors — ensure required fields exist
      parsed.detected_anchors = parsed.detected_anchors.map((a) => ({
        label:            String(a.label ?? ""),
        anchor_type:      String(a.anchor_type ?? "shop"),
        raw_text:         String(a.raw_text ?? a.label ?? ""),
        x_percent:        Number(a.x_percent ?? 50),
        y_percent:        Number(a.y_percent ?? 50),
        confidence_score: Number(a.confidence_score ?? 0.5),
        source_note:      `Gemini vision extraction — floor: ${floorLabel}`,
      }));

      parsed.detected_corridors = parsed.detected_corridors.map((c) => ({
        label:            String(c.label ?? "Corridor Node"),
        x_percent:        Number(c.x_percent ?? 50),
        y_percent:        Number(c.y_percent ?? 50),
        confidence_score: Number(c.confidence_score ?? 0.5),
      }));

    } catch (_parseErr) {
      return {
        status:   "error",
        provider: "gemini_vision_extraction",
        error:    `Failed to parse Gemini JSON response: ${rawText.slice(0, 200)}`,
      };
    }

    return { status: "ok", provider: "gemini_vision_extraction", data: parsed };

  } catch (err) {
    return {
      status:   "error",
      provider: "gemini_vision_extraction",
      error:    String(err),
    };
  }
}

// ── 4. Gemini Embedding ───────────────────────────────────────────────────────

export interface GeminiEmbeddingResult {
  embedding: number[];
  dimensions: number;
}

/**
 * Generate a text embedding for a store/landmark label using Gemini.
 * Returns not_configured when the API key is absent or Google AI is disabled.
 */
export async function runGeminiEmbedding(
  text: string,
): Promise<ProviderResult<GeminiEmbeddingResult>> {
  if (!isGeminiConfigured()) {
    return { status: "not_configured", provider: "gemini_embedding" };
  }

  const apiKey = process.env.GEMINI_API_KEY!;

  try {
    const requestBody = {
      model:   "models/text-embedding-004",
      content: { parts: [{ text }] },
    };

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(requestBody),
      },
    );

    if (!resp.ok) {
      const errText = await resp.text();
      return {
        status:   "error",
        provider: "gemini_embedding",
        error:    `Gemini Embedding API ${resp.status}: ${errText.slice(0, 200)}`,
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await resp.json();
    const values: number[] = json?.embedding?.values ?? [];

    return {
      status:   "ok",
      provider: "gemini_embedding",
      data:     { embedding: values, dimensions: values.length },
    };

  } catch (err) {
    return {
      status:   "error",
      provider: "gemini_embedding",
      error:    String(err),
    };
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Fetch an image URL and return its contents as a base64 string.
 * Used to embed the image inline in Gemini requests.
 */
async function fetchImageAsBase64(url: string): Promise<string> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch image for Gemini: HTTP ${resp.status} — ${url}`);
  const buffer = await resp.arrayBuffer();
  return Buffer.from(buffer).toString("base64");
}
