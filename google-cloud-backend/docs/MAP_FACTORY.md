# Map Factory — Backend Reference

## Overview

Map Factory is an 8-stage autonomous mall cartography pipeline:

| Stage | ID | Description |
|-------|----|-------------|
| 1 | `source_discovery`     | Classify evidence sources (images, PDFs, GDS assets) |
| 2 | `asset_harvest`        | Fetch, hash, and dedup raw assets |
| 3 | `ai_extraction`        | AI anchor + corridor extraction |
| 4 | `layout_intelligence`  | Merge evidence, resolve conflicts |
| 5 | `floorplan_generation` | Generate proprietary floor plan |
| 6 | `route_graph_build`    | Auto-build route nodes + edges |
| 7 | `qa_review`            | Readiness score + QA checks |
| 8 | `publish`              | Publish guard + audit trail |

---

## AI Extraction Providers

### Provider chain

When Stage 3 (AI extraction) runs, it tries providers in this order, falling back to the next on failure:

```
gemini_vision_extraction → google_vision_ocr → mock
```

The `mock` provider is always the terminal fallback — it never fails and returns deterministic test data.

### Enabling Google AI

All Google AI providers are **disabled by default**. Enable them by setting:

```env
MAP_FACTORY_ENABLE_GOOGLE_AI=true
```

Without this flag, the pipeline runs entirely on the mock provider regardless of which API keys or project IDs are present.

### Google Vision OCR (`google_vision_ocr`)

**Auth: Application Default Credentials (ADC) — no API key required.**

The Vision OCR provider uses the official `@google-cloud/vision` Node.js client which authenticates via [Application Default Credentials](https://cloud.google.com/docs/authentication/application-default-credentials).

**On Cloud Run:**  
The service account attached to the Cloud Run service is used automatically. Grant it the `roles/cloudvision.admin` or `roles/cloudvision.serviceAgent` IAM role.

**In local development:**
```bash
gcloud auth application-default login
export GOOGLE_CLOUD_PROJECT=your-project-id
export MAP_FACTORY_ENABLE_GOOGLE_AI=true
```

**Required env vars:**
| Variable | Required | Notes |
|----------|----------|-------|
| `MAP_FACTORY_ENABLE_GOOGLE_AI` | Yes | Must be `"true"` |
| `GOOGLE_CLOUD_PROJECT` | Yes | Your GCP project ID |
| `GOOGLE_CLOUD_VISION_API_KEY` | **No** | Not used — ADC is used instead |

**`isVisionConfigured()` returns `true` when:**
- `MAP_FACTORY_ENABLE_GOOGLE_AI === "true"`  
- `GOOGLE_CLOUD_PROJECT` is set

### Gemini Vision Extraction (`gemini_vision_extraction`)

**Auth: API key via `GEMINI_API_KEY`.**

Calls Gemini 1.5 Flash with the floor plan image bytes and a structured extraction prompt. Returns a JSON response with `detected_anchors`, `detected_corridors`, and `floor_label`.

**Required env vars:**
| Variable | Required | Notes |
|----------|----------|-------|
| `MAP_FACTORY_ENABLE_GOOGLE_AI` | Yes | Must be `"true"` |
| `GEMINI_API_KEY` | Yes | From Google AI Studio |

### Gemini Embedding (`gemini_embedding`)

**Auth: API key via `GEMINI_API_KEY`.**  
Uses `text-embedding-004` for store/landmark label embeddings. Not part of the extraction chain — available for future similarity search.

### Google Document AI Layout (`google_document_ai_layout`)

**Status: skeleton — not yet implemented.**  
Currently always returns `not_configured`. A full implementation requires the `google-auth-library` OAuth flow for Document AI processor access.

---

## Environment Variables

### Required (for any stage)

None — the pipeline runs with mock extraction by default.

### Optional (for Google AI)

| Variable | Description |
|----------|-------------|
| `MAP_FACTORY_ENABLE_GOOGLE_AI` | Set to `"true"` to enable Google AI providers |
| `GOOGLE_CLOUD_PROJECT` | GCP project ID — required for Vision OCR |
| `GEMINI_API_KEY` | Gemini API key — required for Gemini Vision and Embedding |
| `GOOGLE_DOCUMENT_AI_PROCESSOR_ID` | Document AI processor ID (skeleton, not yet used) |
| `MAP_FACTORY_AI_PROVIDER` | Override active provider: `mock` (default) \| `gemini_vision_extraction` \| `google_vision_ocr` |

> **Note:** `GOOGLE_CLOUD_VISION_API_KEY` is **not used**. Vision OCR authenticates via ADC.

---

## Cloud Run Deployment Notes

The Map Factory backend is deployed as a Cloud Run service. Relevant considerations:

1. **Service account**: Attach a service account with `roles/cloudvision.serviceAgent` for Vision OCR.
2. **Project ID**: Set `GOOGLE_CLOUD_PROJECT` in the Cloud Run service's environment variables.
3. **Gemini API key**: Store in Google Secret Manager and inject as an env var — do not hardcode.
4. **Enable Google AI**: Set `MAP_FACTORY_ENABLE_GOOGLE_AI=true` in Cloud Run env vars.
5. **No API key for Vision**: Do not set `GOOGLE_CLOUD_VISION_API_KEY`. Cloud Run uses the service account identity automatically.

---

## Extraction Caching

Each extraction row in `map_factory_extractions` stores a `content_hash` (SHA-256 of the asset bytes). When the same asset is extracted again, the pipeline checks for an existing `complete` row with the same `content_hash` and returns it without calling the AI API again.

To force re-extraction (e.g. after updating the extraction prompt), pass `forceExtract: true` to `extractAsset()`.

---

## Route Graph Builder

### Floor label resolution

Layout models may have a null `floor_label`. The graph builder resolves the floor for each anchor using `resolveFloorLabel(model.floor_label, jobFloorLabel)`:

1. Model's own `floor_label` if well-formed (e.g. "Level 5", "Ground Floor")
2. Job-level `floor_label` (from the API request body) if model floor is null
3. `"Unknown"` as final fallback

### Stale floor repair

Nodes with stale floor values (`null`, `""`, `"G"`, `"L1"`, `"L2"`, etc.) are repaired in-place when the graph builder re-runs, provided their `source` is `map_factory` or `null`. Nodes with `source = geodirectory | admin | manual` are protected from auto-repair.

Use `POST /admin/map-factory/jobs/:jobId/repair-node-floors` to run a standalone repair pass without rebuilding the full graph.

---

## Admin UI

The Map Factory admin panel is at **Admin → Map Factory** in the MallMind admin dashboard.

Key controls:
- **Job queue** — sidebar list of all jobs with status indicators
- **Stage actions** — run each pipeline stage individually or use "Run Next Best Step"
- **AI Extraction Providers panel** — shows configured/not-configured status per provider; click "Check" to query live status
- **Floor label input** — used by Floorplan Generation and Route Graph Build
- **Repair Floors button** — runs the standalone floor repair pass
- **QA Report** — blocking issues and warnings before publish
