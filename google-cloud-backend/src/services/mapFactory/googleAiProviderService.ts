/**
 * googleAiProviderService.ts — Sprint 16.1
 *
 * Thin wrappers for Google AI APIs used by the Map Factory extraction pipeline.
 *
 * Authentication strategy:
 *   • Google Vision OCR — uses Application Default Credentials (ADC) via the
 *     official @google-cloud/vision Node.js client.  On Cloud Run this is the
 *     service account identity; in local dev run
 *     `gcloud auth application-default login` once.  No API key required.
 *   • Gemini (Vision extraction + Embedding) — uses GEMINI_API_KEY (REST).
 *   • Document AI — skeleton only; requires google-auth-library OAuth flow
 *     (not yet implemented).
 *
 * Every function:
 *   • Returns a structured "not_configured" result when prerequisites are absent
 *     — never throws due to missing configuration.
 *   • Only activates when MAP_FACTORY_ENABLE_GOOGLE_AI=true (explicit opt-in).
 *   • Never logs API keys or project credentials.
 *
 * Providers:
 *   runVisionOcr()              — Google Vision text detection (ADC)
 *   runDocumentAiLayout()       — Document AI layout (skeleton)
 *   runGeminiVisionExtraction() — Gemini 1.5 Flash vision (GEMINI_API_KEY)
 *   runGeminiEmbedding()        — Gemini text-embedding (GEMINI_API_KEY)
 *
 * Config helpers (used by mapFactoryProviderRegistry.ts):
 *   isGoogleAiEnabled()
 *   isVisionConfigured()        — true when GOOGLE_CLOUD_PROJECT present + AI enabled
 *   isDocumentAiConfigured()
 *   isGeminiConfigured()
 */

import { ImageAnnotatorClient } from "@google-cloud/vision";
import type { DetectedAnchor, DetectedCorridor } from "../mapImageExtractionService.js";

// ── Config helpers ────────────────────────────────────────────────────────────

/** Returns true only when MAP_FACTORY_ENABLE_GOOGLE_AI=true is explicitly set. */
export function isGoogleAiEnabled(): boolean {
  return process.env.MAP_FACTORY_ENABLE_GOOGLE_AI === "true";
}

/**
 * Vision OCR is available when Google AI is enabled and GOOGLE_CLOUD_PROJECT
 * is set.  Authentication is handled by ADC — no API key is required.
 */
export function isVisionConfigured(): boolean {
  return isGoogleAiEnabled() && !!process.env.GOOGLE_CLOUD_PROJECT;
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
//
// Uses the official @google-cloud/vision Node.js client which authenticates
// through Application Default Credentials (ADC).  On Cloud Run the runtime
// service account is used automatically — no GOOGLE_CLOUD_VISION_API_KEY needed.
//
// Local development:
//   gcloud auth application-default login
//   export GOOGLE_CLOUD_PROJECT=your-project-id
//   export MAP_FACTORY_ENABLE_GOOGLE_AI=true

export interface VisionOcrResult {
  full_text:   string;
  text_blocks: Array<{ text: string; confidence: number }>;
}

// Lazy singleton — created on first use so module load never blocks
let _visionClient: ImageAnnotatorClient | null = null;

function getVisionClient(): ImageAnnotatorClient {
  if (!_visionClient) {
    _visionClient = new ImageAnnotatorClient({
      projectId: process.env.GOOGLE_CLOUD_PROJECT,
      // Credentials come from ADC (Cloud Run SA / gcloud application-default)
    });
  }
  return _visionClient;
}

/**
 * Run Google Vision text detection on an image URL.
 * Fetches the image bytes and sends them to the Vision API via ADC.
 * Returns not_configured when Google AI is disabled or GOOGLE_CLOUD_PROJECT
 * is absent.
 */
export async function runVisionOcr(
  imageUrl: string,
): Promise<ProviderResult<VisionOcrResult>> {
  if (!isVisionConfigured()) {
    return { status: "not_configured", provider: "google_vision_ocr" };
  }

  try {
    const client      = getVisionClient();
    const imageContent = await fetchImageBuffer(imageUrl);

    const [response] = await client.textDetection({
      image: { content: imageContent },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const annotation = (response as any).fullTextAnnotation as {
      text?: string;
      pages?: Array<{
        blocks?: Array<{
          confidence?: number;
          paragraphs?: Array<{
            words?: Array<{ symbols?: Array<{ text?: string }> }>;
          }>;
        }>;
      }>;
    } | null | undefined;

    const fullText: string = annotation?.text ?? "";

    const textBlocks: Array<{ text: string; confidence: number }> = [];
    for (const page of (annotation?.pages ?? [])) {
      for (const block of (page.blocks ?? [])) {
        const blockText: string = (block.paragraphs ?? [])
          .flatMap((p) =>
            (p.words ?? []).map((w) =>
              (w.symbols ?? []).map((s) => s.text ?? "").join("")
            )
          )
          .join(" ");
        if (blockText.trim()) {
          textBlocks.push({ text: blockText.trim(), confidence: block.confidence ?? 0 });
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
      error:    `Vision OCR failed: ${String(err)}`,
    };
  }
}

// ── 2. Document AI Layout ─────────────────────────────────────────────────────
//
// Document AI requires OAuth 2.0 (service account) — currently a skeleton.
// When Document AI is needed, install google-auth-library and implement the
// OAuth token refresh + REST call to
//   POST https://documentai.googleapis.com/v1/projects/{project}/locations/{location}/
//            processors/{processorId}:process
// The @google-cloud/vision client pattern above can be reused.

export interface DocumentAiLayoutResult {
  pages:    number;
  entities: Array<{ type: string; text: string; confidence: number }>;
}

export async function runDocumentAiLayout(
  _documentUrl: string,
): Promise<ProviderResult<DocumentAiLayoutResult>> {
  if (!isDocumentAiConfigured()) {
    return { status: "not_configured", provider: "google_document_ai_layout" };
  }

  // Skeleton — full implementation deferred
  return {
    status:   "not_configured",
    provider: "google_document_ai_layout",
    error:    "Document AI not yet implemented — use Gemini Vision as primary extractor",
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
 * Returns not_configured when GEMINI_API_KEY is absent or Google AI is disabled.
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
        temperature:      0,
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
  embedding:  number[];
  dimensions: number;
}

/**
 * Generate a text embedding for a store/landmark label using Gemini.
 * Returns not_configured when GEMINI_API_KEY is absent or Google AI is disabled.
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
 * Fetch an image URL and return its raw bytes as a Buffer.
 * Used by both Vision OCR and Gemini Vision.
 */
async function fetchImageBuffer(url: string): Promise<Buffer> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch image: HTTP ${resp.status} — ${url}`);
  const arrayBuffer = await resp.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Fetch an image URL and return its contents as a base64 string.
 * Used to embed images inline in Gemini requests.
 */
async function fetchImageAsBase64(url: string): Promise<string> {
  return (await fetchImageBuffer(url)).toString("base64");
}
