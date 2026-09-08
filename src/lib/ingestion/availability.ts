/**
 * Availability derivation — maps the detailed availability scope to the coarse
 * RC1 availability_status. Conservative: only asserts "known_available" when the
 * scope genuinely supports it, never from website + store presence alone.
 */

import type { AvailabilityLabel, AvailabilityStatus } from "./model";

export function deriveAvailabilityStatus(scope: AvailabilityLabel): AvailabilityStatus {
  switch (scope) {
    case "branch_stock_confirmed":
    case "collection_available":
    case "online_stock_only":
      return "known_available";
    case "out_of_stock":
    case "no_longer_listed":
      return "unavailable";
    case "retailer_range_observed":
    case "store_presence_confirmed":
    case "inferred_not_confirmed":
      return "inferred";
    case "availability_unknown":
    default:
      return "unknown";
  }
}
