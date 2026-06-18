/**
 * Shopping Assistant Intelligence Engine v1 — barrel export.
 *
 * Pure, deterministic shopper-recommendation logic. Callers fetch DB rows,
 * map them to plain ShopperCandidate objects, and call buildShoppingAnswer.
 */

export * from "./assistantTypes";
export * from "./deterministicShoppingIntent";
export * from "./deterministicProductFilter";
export * from "./shopperCandidateMapper";
export * from "./deterministicShoppingAnswer";
export * from "./productTargetExtractor";
export * from "./routeIntentExtractor";
export * from "./shoppingIntentClassifier";
export * from "./shopperTrustLabels";
export * from "./productRecommendationRanker";
export * from "./shoppingAnswerBuilder";
