/**
 * buildInfo.ts — the build marker baked in by vite.config.ts (`define`), e.g. "2026-09-13T16:52:10Z 059921d".
 * Shown in the Navigate footer and as <meta name="mallmind-build"> so a hosted deployment can be
 * proven to serve a given tree from any phone. Falls back safely when the define is absent.
 */
declare const __MALLMIND_BUILD__: string | undefined;

export const BUILD_MARKER: string = typeof __MALLMIND_BUILD__ === "string" && __MALLMIND_BUILD__ ? __MALLMIND_BUILD__ : "unknown";
