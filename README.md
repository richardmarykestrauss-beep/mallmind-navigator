# MallMind

MallMind is an AI-assisted shopping and indoor-navigation platform for South African malls.

## Build OS authority

Engineering work is governed by:

- docs/build-os/AUTHORITY.md
- docs/build-os/ARCHITECTURE.md
- docs/build-os/DECISIONS.md
- docs/build-os/project-state.json

Specialist documents under docs/ remain supporting references and evidence.

## Verification

Authoritative command: npm run verify:all

The same command runs through .github/workflows/verify.yml.

## Runtime

- Node.js 22.x
- npm
- React, Vite and TypeScript frontend
- Node.js, Express and TypeScript backend
- Supabase PostgreSQL
- Google Vertex AI / Gemini
- Google Cloud Run
