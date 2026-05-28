# MallMind Source / IP / Security Matrix

## Purpose

MallMind must use every legally available tool, API, dataset, public reference source, and field-verification method that can accelerate the product — without weakening our IP, exposing secrets, or making the app dependent on vendor-owned map data.

Core rule:

> External evidence in. MallMind-owned structured graph out.

MallMind should not simply display copied third-party mall maps as the product. MallMind should convert lawful reference evidence into its own proprietary indoor commerce graph.

---

## Core IP Asset

MallMind's protectable asset is the **MallMind Indoor Commerce Graph**:

- proprietary reconstructed floorplan SVGs
- store-to-node coordinates
- walking route graph edges
- floor transition logic
- entrances, exits, parking, and anchor-store relationships
- store/category/product matching
- route behavior analytics
- shopper intent data
- field-verified correction history

---

## Security Doctrine

Frontend must never contain privileged secrets.

Frontend allowed:

- public Supabase anon key only
- public-safe config only
- no service-role keys
- no unrestricted Google / Mapbox / HERE / vendor secrets
- no admin tokens

Backend required:

- Google Cloud Run for sensitive operations
- Google Secret Manager for API keys
- service accounts with least privilege
- approval gates for admin operations
- rate limiting for expensive APIs
- audit logs for imports and publishes
- cache only where legally allowed

---

## Data Privacy Doctrine

MallMind may eventually create valuable mall intelligence, but must avoid unsafe personal tracking.

Preferred data products:

- aggregated store interest
- aggregated route demand
- anonymous mall heatmaps
- category intent trends
- parking-to-store flow insights
- anonymized conversion-style events

Avoid selling:

- raw user movement paths
- personally identifiable shopping behavior
- unconsented individual tracking data
- persistent device-level behavior profiles without consent

---

## Source Decision Matrix

| Source | Gives Us | Commercial Use Risk | Storage Risk | Security Risk | IP Value | Decision |
|---|---|---:|---:|---:|---:|---|
| Our own field data | verified store positions, entrances, routes | Low | Low | Low | Very High | USE |
| Our reconstructed SVG floorplans | proprietary map asset | Low if original artwork | Low | Low | Very High | USE |
| Mall website public floorplan images | reference evidence | Medium/High | High if copied | Low | Medium | REFERENCE ONLY |
| Public mall directory screenshots/photos | visual evidence | Medium | High if copied | Low | Medium | REFERENCE ONLY |
| Google Indoor Maps | visual reference, indoor floor hints | High for extraction/reuse | High | Medium | Low/Medium | REFERENCE ONLY |
| Google Places API | store metadata, hours, place IDs | Medium | Medium/High | Medium | Medium | BACKEND-ONLY ENRICHMENT |
| Google Routes/Geocoding | outdoor navigation to mall/parking | Medium | Medium | Medium | Medium | BACKEND-ONLY OUTDOOR |
| Mapbox Indoor | renderer/tooling inspiration | Medium | Medium | Medium | Medium | PILOT ONLY |
| HERE Indoor Maps | indoor GeoJSON/data if licensed | Contract-dependent | Contract-dependent | Medium | High | CONTACT SALES / PILOT |
| Mappedin | indoor map tooling/SDKs | Contract-dependent | Contract-dependent | Medium | High | BENCHMARK / PILOT |
| MapsIndoors | indoor map + POI platform | Contract-dependent | Contract-dependent | Medium | High | BENCHMARK / PILOT |
| Pointr | indoor mapping/positioning | Contract-dependent | Contract-dependent | Medium | High | BENCHMARK / PILOT |
| Situm | indoor positioning/maps/navigation | Contract-dependent | Contract-dependent | Medium | High | BENCHMARK / PILOT |
| OpenStreetMap indoor tags | schema/data model inspiration | Medium if importing data | Medium/High due ODbL | Low | Medium | SCHEMA INSPIRATION |
| Overture Maps | building/place identity | Low/Medium | Low/Medium | Low | Medium | USE FOR OUTER VENUE ENRICHMENT |
| Retailer store locator APIs | store names, locations, hours | Medium | Medium | Medium | High | BACKEND-ONLY IF TERMS ALLOW |
| Scraping behind logins/paywalls | hidden data | High | High | High | Low | AVOID |
| Frontend API keys | direct browser access | High | High | High | None | AVOID |

---

## MallMind Data Conversion Rule

Every source must be converted into a MallMind-owned structure before it becomes core product data.

Example:

Public Sandton reference image
→ human/AI-assisted reconstruction
→ original MallMind SVG
→ layout_json
→ mall_nodes
→ mall_edges
→ store-node links
→ field-verified coordinate corrections

We should never make the external source itself the core product.

---

## Pilot Mall Digital Twin Workflow

For Sandton and the first 1–3 pilot malls:

1. Collect lawful public reference evidence.
2. Reconstruct our own simplified vector floorplan.
3. Apply MallMind premium 2.5D visual style.
4. Place store nodes.
5. Link stores to existing shop records.
6. Build corridor/entrance/transition edges.
7. Run in-app route tests.
8. Send trusted testers to verify reality.
9. Store correction history.
10. Publish only after QA.

---

## Decision Labels

### USE

Safe and useful as part of MallMind core data.

### REFERENCE ONLY

Can help us understand the mall, but must not be copied directly into the app.

### BACKEND-ONLY ENRICHMENT

Can enrich MallMind data, but must run through Cloud Run, Secret Manager, rate limits, and legal TTL/caching rules.

### BENCHMARK / PILOT

Potentially useful vendor/platform, but do not build core IP around it until contract, pricing, and data rights are clear.

### AVOID

Too risky legally, technically, or strategically.

---

## Current Strategic Decision

For Sandton, do not continue trying to force generic artificial rectangles into a premium map.

Move to:

> Human-guided proprietary digital twin reconstruction.

The route engine, map model endpoint, premium renderer, and Map Factory work already built remain valuable. They become the engine underneath a better map asset.
