/**
 * Google Places Verification Service — Sprint 12C
 *
 * Verifies a staged store location against the Google Places API
 * (Places API New — Text Search endpoint).
 *
 * If GOOGLE_PLACES_API_KEY is not set, returns a "not_configured" result
 * immediately without any network call.
 *
 * No DB access. Caller handles persistence.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VerifyStoreInput {
  shop_name:           string;
  mall_name?:          string;
  staged_location_id?: string;
  /** ISO 3166-1 alpha-2 region bias (default "ZA") */
  region_code?:        string;
}

export type VerificationMethod = "google_places_api" | "not_configured" | "failed";

export interface VerifyStoreResult {
  shop_name:           string;
  staged_location_id?: string;
  verified:            boolean;
  place_id?:           string;
  place_name?:         string;
  place_address?:      string;
  /** 0–1 */
  confidence:          number;
  method:              VerificationMethod;
  notes?:              string;
}

// ── Internal ─────────────────────────────────────────────────────────────────

interface PlacesApiResponse {
  places?: Array<{
    id:              string;
    displayName?:    { text: string };
    formattedAddress?: string;
  }>;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Verify a store against Google Places.
 * Returns a "not_configured" stub when GOOGLE_PLACES_API_KEY is absent —
 * callers should not treat this as a failure, just as unverified.
 */
export async function verifyStoreLocation(
  input: VerifyStoreInput,
): Promise<VerifyStoreResult> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  if (!apiKey) {
    return {
      shop_name:           input.shop_name,
      staged_location_id:  input.staged_location_id,
      verified:            false,
      confidence:          0,
      method:              "not_configured",
      notes:               "Set GOOGLE_PLACES_API_KEY to enable Google Places verification",
    };
  }

  const query = [input.shop_name, input.mall_name]
    .filter(Boolean)
    .join(" ");

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method:  "POST",
      signal:  controller.signal,
      headers: {
        "Content-Type":    "application/json",
        "X-Goog-Api-Key":  apiKey,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress",
      },
      body: JSON.stringify({
        textQuery:      query,
        maxResultCount: 3,
        regionCode:     input.region_code ?? "ZA",
      }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        shop_name:           input.shop_name,
        staged_location_id:  input.staged_location_id,
        verified:            false,
        confidence:          0,
        method:              "failed",
        notes:               `Places API returned HTTP ${response.status}`,
      };
    }

    const data = (await response.json()) as PlacesApiResponse;
    const places = data.places ?? [];

    if (places.length === 0) {
      return {
        shop_name:           input.shop_name,
        staged_location_id:  input.staged_location_id,
        verified:            false,
        confidence:          0.30,
        method:              "google_places_api",
        notes:               "No matching place found in Google Places",
      };
    }

    const top      = places[0];
    const nameText = top.displayName?.text ?? "";
    const nameMatch = nameText.toLowerCase().includes(input.shop_name.toLowerCase());

    return {
      shop_name:           input.shop_name,
      staged_location_id:  input.staged_location_id,
      verified:            nameMatch,
      place_id:            top.id,
      place_name:          nameText,
      place_address:       top.formattedAddress,
      confidence:          nameMatch ? 0.85 : 0.40,
      method:              "google_places_api",
      notes:               nameMatch
        ? `Matched: ${nameText}`
        : `Top result was "${nameText}" — name mismatch`,
    };
  } catch (e) {
    clearTimeout(timeoutId);
    const msg = e instanceof Error ? e.message : String(e);
    return {
      shop_name:           input.shop_name,
      staged_location_id:  input.staged_location_id,
      verified:            false,
      confidence:          0,
      method:              "failed",
      notes:               msg.includes("abort") ? "Places API request timed out" : `Error: ${msg}`,
    };
  }
}
