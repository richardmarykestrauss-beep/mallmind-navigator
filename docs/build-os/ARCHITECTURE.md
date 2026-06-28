# MallMind Architecture

Status: Authoritative baseline
Version: 1.0

## Product architecture

MallMind combines a React/Vite frontend, a Node.js/Express backend, Supabase PostgreSQL, Google Vertex AI / Gemini, Google Cloud Run, indoor-routing data and a staged retail-trust pipeline.

## Frontend responsibilities

- Shopping-assistant experience
- Product and price presentation
- Mall selection
- Route and floorplan display
- Voice-guided navigation
- Admin and evidence-review interfaces
- Shopper-safe trust language

The frontend must never expose service-role credentials or privileged database operations.

## Backend responsibilities

- Deterministic shopping-intent handling
- Product filtering and ranking
- Gemini orchestration and safe degradation
- Route construction
- Retail observation staging
- Verification-policy enforcement
- Approved-only publication
- Privileged Supabase access
- Health and operational endpoints

The backend runs on Google Cloud Run in africa-south1.

## Retail trust pipeline

1. Source registration
2. Source snapshot
3. Import batch
4. Price observation staging
5. Administrative review
6. Approved-only publishing
7. Shopper-facing trust calculation
8. Freshness degradation after expiry

Manual CSV and user-submitted data must never silently become verified product facts.

## AI boundary

Deterministic logic handles clear product, budget, cheapest-option, verified-only and direct-route intents where possible.

Gemini handles ambiguous, conversational and mission-shopping requests.

When Gemini fails, MallMind must use deterministic recovery where evidence exists, avoid inventing products or routes and return a safe degraded message otherwise.

## Indoor navigation

The intended navigation system uses real mall nodes, graph edges, floors, entrances, shop destinations, floorplan coordinates, position tracking and voice instructions.

Prototype or simulated tracking must be labelled honestly until real positioning is active.

## Security boundaries

- Public frontend credentials versus backend secrets
- Supabase RLS
- Service-role access only in trusted server environments
- SECURITY DEFINER RPCs with locked search paths
- Explicit grants and revokes
- Source legal-status checks
- Admin approval requirements
- Secret-free CI verification
- Quarantined legacy direct-write automation

## Current deployment topology

- Platform: Google Cloud Run
- Project: mallmind
- Region: africa-south1
- Service: mallmind-backend-dev
- Database: Supabase PostgreSQL
- AI: Google Vertex AI / Gemini
