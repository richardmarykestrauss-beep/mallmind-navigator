import { describe, it, expect, beforeEach, vi } from "vitest";
import { getExtractionProviderChain, getProviderStatus } from "../mapFactoryProviderRegistry.js";
import * as googleAiProviderService from "../googleAiProviderService.js";

vi.mock("../googleAiProviderService.js", () => ({
  isGeminiConfigured: vi.fn(),
  isVisionConfigured: vi.fn(),
  isDocumentAiConfigured: vi.fn(),
  isGoogleAiEnabled: vi.fn(),
}));

describe("mapFactoryProviderRegistry", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("getProviderStatus", () => {
    it("should return mock as always true", () => {
      const status = getProviderStatus();
      expect(status.mock).toBe(true);
    });

    it("should reflect configured status from provider service", () => {
      vi.mocked(googleAiProviderService.isGeminiConfigured).mockReturnValue(true);
      vi.mocked(googleAiProviderService.isVisionConfigured).mockReturnValue(false);
      vi.mocked(googleAiProviderService.isDocumentAiConfigured).mockReturnValue(true);

      const status = getProviderStatus();
      expect(status.gemini_vision_extraction).toBe(true);
      expect(status.google_vision_ocr).toBe(false);
      expect(status.google_document_ai_layout).toBe(true);
      expect(status.gemini_embedding).toBe(true);
    });
  });

  describe("getExtractionProviderChain", () => {
    it("should always end with mock", () => {
      vi.mocked(googleAiProviderService.isGeminiConfigured).mockReturnValue(false);
      vi.mocked(googleAiProviderService.isVisionConfigured).mockReturnValue(false);
      vi.mocked(googleAiProviderService.isDocumentAiConfigured).mockReturnValue(false);

      const chain = getExtractionProviderChain();
      expect(chain).toEqual(["mock"]);
    });

    it("should include gemini and vision ocr when configured for images", () => {
      vi.mocked(googleAiProviderService.isGeminiConfigured).mockReturnValue(true);
      vi.mocked(googleAiProviderService.isVisionConfigured).mockReturnValue(true);
      vi.mocked(googleAiProviderService.isDocumentAiConfigured).mockReturnValue(false);

      const chain = getExtractionProviderChain("image/jpeg");
      expect(chain).toEqual(["gemini_vision_extraction", "google_vision_ocr", "mock"]);
    });

    it("should exclude vision ocr for PDFs", () => {
      vi.mocked(googleAiProviderService.isGeminiConfigured).mockReturnValue(true);
      vi.mocked(googleAiProviderService.isVisionConfigured).mockReturnValue(true);
      vi.mocked(googleAiProviderService.isDocumentAiConfigured).mockReturnValue(false);

      const chain = getExtractionProviderChain("application/pdf");
      expect(chain).toEqual(["gemini_vision_extraction", "mock"]);
    });
  });
});
