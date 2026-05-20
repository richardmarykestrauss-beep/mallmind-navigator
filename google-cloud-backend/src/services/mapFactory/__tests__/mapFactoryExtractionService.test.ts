import { describe, it, expect, beforeEach, vi } from "vitest";
import { extractAsset } from "../mapFactoryExtractionService.js";
import { SupabaseClient } from "@supabase/supabase-js";

// Mock dependencies
vi.mock("../googleAiProviderService.js", () => ({
  runGeminiVisionExtraction: vi.fn(),
  runVisionOcr: vi.fn(),
}));

vi.mock("../mapFactoryProviderRegistry.js", () => ({
  getExtractionProviderChain: vi.fn(() => ["mock"]),
}));

vi.mock("../../mapImageExtractionService.js", () => ({
  getMapImageExtractionProvider: vi.fn(() => ({
    extract: vi.fn().mockResolvedValue({
      floor_label: "L1",
      detected_anchors: [{ label: "Mock Shop" }],
      detected_corridors: [],
      warnings: [],
      provider: "mock",
    }),
  })),
}));

describe("mapFactoryExtractionService", () => {
  let mockSupabase: any;

  beforeEach(() => {
    vi.resetAllMocks();
    mockSupabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(),
      insert: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
    };
  });

  it("should return cached result if forceExtract is false and contentHash matches", async () => {
    mockSupabase.maybeSingle.mockResolvedValue({
      data: {
        id: "cached-123",
        provider_used: "gemini_vision_extraction",
        anchors_saved: 5,
        warnings: ["cached warning"],
      },
    });

    const result = await extractAsset({
      jobId: "job-1",
      mallId: "mall-1",
      assetId: "asset-1",
      assetUrl: "http://example.com/map.jpg",
      floorLabel: "L1",
      contentHash: "hash-123",
      supabase: mockSupabase as unknown as SupabaseClient,
    });

    expect(result.cacheHit).toBe(true);
    expect(result.extractionRowId).toBe("cached-123");
    expect(result.anchorsFound).toBe(5);
    expect(mockSupabase.from).toHaveBeenCalledWith("map_factory_extractions");
  });

  it("should run extraction if cache misses", async () => {
    mockSupabase.maybeSingle.mockResolvedValue({ data: null });
    mockSupabase.single.mockResolvedValue({ data: { id: "new-123" }, error: null });

    const result = await extractAsset({
      jobId: "job-1",
      mallId: "mall-1",
      assetId: "asset-1",
      assetUrl: "http://example.com/map.jpg",
      floorLabel: "L1",
      contentHash: "hash-123",
      supabase: mockSupabase as unknown as SupabaseClient,
    });

    expect(result.cacheHit).toBe(false);
    expect(result.extractionRowId).toBe("new-123");
    expect(result.anchorsFound).toBe(1);
  });

  it("should bypass cache if forceExtract is true", async () => {
    mockSupabase.single.mockResolvedValue({ data: { id: "new-123" }, error: null });

    const result = await extractAsset({
      jobId: "job-1",
      mallId: "mall-1",
      assetId: "asset-1",
      assetUrl: "http://example.com/map.jpg",
      floorLabel: "L1",
      contentHash: "hash-123",
      forceExtract: true,
      supabase: mockSupabase as unknown as SupabaseClient,
    });

    expect(mockSupabase.maybeSingle).not.toHaveBeenCalled();
    expect(result.cacheHit).toBe(false);
  });
});
