/**
 * Retail Intelligence Core v1 — barrel export.
 *
 * Pure, deterministic retail decision logic shared by the backend admin
 * publish-preview route and the scripts/retail/*.mjs tools (which consume
 * the compiled output in google-cloud-backend/dist/services/retail/).
 */

export * from "./retailTypes";
export * from "./retailNameMatcher";
export * from "./retailTrustMapper";
export * from "./retailWarnings";
export * from "./retailPublishPlanner";
