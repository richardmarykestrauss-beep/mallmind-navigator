import { describe, it, expect } from "vitest";
import {
  validateAnchor, manualAnchorProvider, qrAnchorProvider, deepLinkSearchFromQrText, anchorProviderFor, toPilotAnchor,
  IMPLEMENTED_ANCHOR_SOURCES, FUTURE_ANCHOR_SOURCES, ANCHOR_REASONS,
} from "./anchorProvider";
import { parseWayfindingAnchor, qrLinkFor, wayfindingLinkFor } from "./wayfindingAnchor";

const GRM = "garden-route-mall";
const E4 = "grm-entrance-4";

describe("AnchorProvider contract — one trust gate for every way of learning where a visitor starts", () => {
  it("manual: a permitted start of a known mall resolves to a trusted, registry-validated anchor", () => {
    const r = manualAnchorProvider.resolve({ mallId: GRM, anchorId: E4 }, 1000);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.anchor).toEqual({ mallId: GRM, anchorId: E4, label: "Entrance 4", source: "manual", resolvedAt: 1000, evidence: "registry" });
    expect(toPilotAnchor(r.anchor)).toEqual({ nodeId: E4, label: "Entrance 4", source: "manual" });
  });

  it("qr: the canonical deep link (absolute or site-relative) resolves to a qr-sourced anchor", () => {
    for (const text of [
      `https://mallmind.example${qrLinkFor(GRM, E4)}`,
      qrLinkFor(GRM, E4),
      `https://mallmind.example/pilot?mall=${GRM}&start=${E4}`,
      `HTTP://MALLMIND.EXAMPLE/navigate/?mall=${GRM}&start=${E4}`,
    ]) {
      const r = qrAnchorProvider.resolve(text, 5);
      expect(r.status, text).toBe("ok");
      if (r.status === "ok") expect(r.anchor).toMatchObject({ mallId: GRM, anchorId: E4, source: "qr", resolvedAt: 5 });
    }
  });

  it("invalid mall fails safely with a human reason", () => {
    for (const mall of ["sandton-city", "", "../etc", "<script>", "garden route mall"]) {
      const r = validateAnchor(mall, E4, "manual");
      expect(r.status, mall).toBe("failed");
      if (r.status === "failed") {
        expect(["unknown_mall", "malformed"]).toContain(r.code);
        expect(r.reason).not.toMatch(/stack|TypeError|undefined/i);
      }
    }
  });

  it("invalid anchor fails safely (unknown node, non-start node, junk)", () => {
    const unknown = validateAnchor(GRM, "grm-entrance-99", "manual");
    expect(unknown).toMatchObject({ status: "failed", code: "unknown_anchor", mallId: GRM, reason: ANCHOR_REASONS.notAStart });
    const corridor = validateAnchor(GRM, "grm-walkway-e5", "manual");
    expect(corridor).toMatchObject({ status: "failed", code: "not_a_start" });
    const shop = validateAnchor(GRM, "grm-clicks-arrival", "qr");
    expect(shop).toMatchObject({ status: "failed", code: "not_a_start" });
    for (const junk of ["", " ", "../../x", "%00", "a".repeat(70)]) {
      expect(validateAnchor(GRM, junk, "manual").status, junk).toBe("failed");
    }
  });

  it("an anchor that belongs to another mall is rejected for this mall", () => {
    expect(validateAnchor(GRM, "menlyn-lf-entrance-13", "qr")).toMatchObject({ status: "failed", code: "unknown_anchor", mallId: GRM });
    expect(validateAnchor("menlyn-park", E4, "qr")).toMatchObject({ status: "failed", code: "unknown_anchor", mallId: "menlyn-park" });
    expect(validateAnchor("mallreds-pilot", E4, "manual").status).toBe("failed");
  });

  it("qr: anything that is not a MallMind deep link is malformed — never a redirect or an anchor", () => {
    for (const text of [
      "", "hello", "WIFI:S:mall;;", "javascript:alert(1)", "mailto:x@y.z", "ftp://mallmind.example/navigate?mall=x&start=y",
      "https://evil.example/", "https://mallmind.example/admin?mall=garden-route-mall&start=grm-entrance-4",
      "/navigate", "https://mallmind.example/navigate?mall=garden-route-mall", "x".repeat(3000),
    ]) {
      const r = qrAnchorProvider.resolve(text);
      expect(r.status, text).toBe("failed");
      if (r.status === "failed") expect(r.reason.length).toBeGreaterThan(10);
    }
    expect(deepLinkSearchFromQrText("https://mallmind.example/navigate?mall=a&start=b")).toBe("?mall=a&start=b");
    expect(deepLinkSearchFromQrText("https://mallmind.example/deals")).toBeNull();
  });

  it("qr payloads cannot smuggle markup: the resolved label always comes from the registry", () => {
    const r = qrAnchorProvider.resolve(`/navigate?mall=${GRM}&start=${E4}&label=<img src=x onerror=alert(1)>`);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.anchor.label).toBe("Entrance 4");
  });

  it("future providers are reserved seams only: no provider exists and nothing is pretended", () => {
    expect(IMPLEMENTED_ANCHOR_SOURCES).toEqual(["manual", "qr", "url"]);
    expect(FUTURE_ANCHOR_SOURCES).toEqual(["native", "wifi_rtt", "uwb", "apple_indoor"]);
    for (const s of FUTURE_ANCHOR_SOURCES) expect(anchorProviderFor(s)).toBeNull();
    expect(anchorProviderFor("manual")?.source).toBe("manual");
    expect(anchorProviderFor("qr")?.source).toBe("qr");
  });
});

describe("deep links — the existing pattern stays valid; via=qr marks a scanned code", () => {
  it("/navigate?mall=&start= (no via) → url-sourced anchor, unchanged behaviour", () => {
    const r = parseWayfindingAnchor(wayfindingLinkFor(GRM, E4).split("?")[1]);
    expect(r).toMatchObject({ status: "ok", mallId: GRM, anchor: { nodeId: E4, label: "Entrance 4", source: "url" } });
  });

  it("via=qr → qr-sourced anchor; any other via value is ignored", () => {
    expect(qrLinkFor(GRM, E4)).toBe(`/navigate?mall=${GRM}&start=${E4}&via=qr`);
    const qr = parseWayfindingAnchor(`?mall=${GRM}&start=${E4}&via=qr`);
    expect(qr.status).toBe("ok");
    if (qr.status === "ok") expect(qr.anchor.source).toBe("qr");
    const other = parseWayfindingAnchor(`?mall=${GRM}&start=${E4}&via=<b>x</b>`);
    if (other.status === "ok") expect(other.anchor.source).toBe("url");
    expect(other.status).toBe("ok");
  });

  it("malformed deep links fail safely through the same gate", () => {
    expect(parseWayfindingAnchor(`?mall=${GRM}&start=menlyn-lf-entrance-13&via=qr`)).toMatchObject({ status: "invalid", mallId: GRM });
    expect(parseWayfindingAnchor("?mall=nope&start=x&via=qr")).toMatchObject({ status: "invalid", mallId: null });
    expect(parseWayfindingAnchor(`?start=${E4}&via=qr`)).toMatchObject({ status: "invalid", reason: ANCHOR_REASONS.noMall });
  });
});
