# Indoor Mapping Battlefield Dossier

## Purpose

This dossier tracks the wider indoor mapping, wayfinding, positioning, kiosk, mobile-map, API, and analytics battlefield around MallMind.

Strategic conclusion: MallMind must not compete as generic indoor GPS. Indoor maps, QR mobile access, blue-dot navigation, 3D maps, POI search, analytics, CMS updates, SDKs, and AI map creation already exist in the market.

## MallMind Winning Wedge

MallMind should attack from the consumer shopping intelligence side:

- AI shopping assistant
- product/deal comparison
- budget-aware shopping route
- shopping-list route optimization
- cross-mall product discovery
- South African retail intelligence
- privacy-safe consumer behavior analytics
- MallMind Indoor Commerce Graph

## Competitor / Platform Matrix

| Player | Strong Area | Threat | MallMind Decision |
|---|---|---:|---|
| ViaDirect | mall kiosks, QR mobile maps, 3D wayfinding, analytics, AI product search | HIGH | Direct benchmark / competitor / possible future partner |
| Mappedin | AI-powered map creation, SDKs, APIs, mall/campus/venue maps | HIGH | Study tooling; do not make map editor the main moat |
| MapsIndoors / MapsPeople | indoor/outdoor maps, POIs, wayfinding, Integration API, CMS | HIGH | Study API/data model; possible enterprise benchmark |
| Pointr | blue-dot positioning, indoor maps, product-level search, analytics | HIGH | Serious technical threat; avoid head-on infrastructure race |
| Situm | indoor positioning, 3D maps, AR wayfinding, geo-analytics | MEDIUM-HIGH | Positioning benchmark / possible future integration idea |
| HERE Indoor Maps | indoor GeoJSON/data/API if licensed | MEDIUM-HIGH | Investigate only under contract/data-rights review |
| 22Miles | digital signage, kiosks, 3D wayfinding, AI map generation | MEDIUM-HIGH | Benchmark signage/AI map generation; not core dependency |
| MazeMap | campus/hospital/corporate indoor maps and APIs | MEDIUM | Study API design and embeddable map behavior |
| Cisco Spaces | Wi-Fi/BLE location infrastructure, blue-dot, 3D maps | MEDIUM-HIGH | Infrastructure threat; integrate later only if needed |
| Google Indoor / Places | indoor Google Maps, POI metadata, outdoor routing | STRATEGIC | Use cautiously; not MallMind-owned indoor graph |
| Mapbox Indoor | rendering/tooling, indoor support, tilesets | STRATEGIC | Possible rendering/tooling layer; not mall data source |

## What the Market Already Has

- 2D/3D indoor maps
- QR/no-download mobile maps
- blue-dot positioning
- step-by-step indoor routing
- kiosk-to-phone handoff
- POI/store search
- product-level search in some platforms
- analytics dashboards
- CMS/admin map updates
- SDKs and APIs
- AI-assisted map creation

## MallMind Must Not Waste Time On

- becoming only a kiosk company
- generic venue wayfinding as the main product
- competing head-on with Cisco/Pointr/Situm on infrastructure-heavy blue-dot positioning at the start
- depending on third-party indoor map assets as core IP
- putting API keys or privileged tokens in the frontend

## MallMind Should Build

- proprietary reconstructed mall floorplans
- store-node coordinate graph
- route edges and floor transitions
- product-to-store matching
- shopping-list optimization
- budget-aware recommendation engine
- cross-mall product/deal intelligence
- privacy-safe analytics layer
- field-verification feedback loop

## Data Model Direction

MallMind should align internally with GeoJSON/IMDF-like ideas without copying restricted third-party data.

Core concepts:
- venue
- building
- floor/level
- unit/store
- corridor
- entrance/door
- POI/service
- route node
- edge
- product/deal/store relationship

## Strategic Decision

For the first pilot malls, MallMind should not chase full enterprise blue-dot infrastructure. Build a proprietary digital twin, manual/current-position correction, route graph, and shopping mission layer first. Evaluate positioning infrastructure later.

## Source Notes

- Mappedin official site and developer/material pages
- MapsIndoors official docs and MapsPeople/Mapbox showcase
- Pointr official product pages and Microsoft Marketplace listing
- Situm official platform and docs
- HERE Indoor Maps docs
- 22Miles wayfinding and AI map generation articles
- MazeMap official site and developer API pages
- Cisco Spaces indoor navigation and SDK pages
- Google Indoor Maps and Google Maps Platform service terms
- Mapbox indoor mapping documentation and indoor airport map content
