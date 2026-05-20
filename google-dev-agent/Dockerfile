# ── Stage 1: Builder ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies (separate layer for cache)
COPY package.json ./
RUN npm install

# Copy source and compile TypeScript
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── Stage 2: Production image ─────────────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

# Create a non-root user
RUN addgroup --system --gid 1001 agent && \
    adduser --system --uid 1001 agent

# Copy compiled output and production deps only
COPY --from=builder /app/dist ./dist
COPY package.json ./
RUN npm install --omit=dev

# Create reports directory (writable by agent user)
RUN mkdir -p /reports/dev-agent && chown -R agent:agent /reports

USER agent

# ── Runtime config ─────────────────────────────────────────────────────────────
# All config comes from environment variables.
# Secrets are injected via Secret Manager at Cloud Run runtime — never baked in.

ENV NODE_ENV=production
ENV REPORTS_DIR=/reports/dev-agent

# CLOUD_RUN_DEV_URL      — target backend URL (set via Cloud Run env or --set-env-vars)
# GOOGLE_CLOUD_PROJECT   — for Vertex AI (set via Cloud Run)
# VERTEX_AI_LOCATION     — Gemini region, default us-central1
# SUPABASE_URL           — injected from Secret Manager
# SUPABASE_SERVICE_ROLE_KEY — injected from Secret Manager
# TASK                   — task type, default VERIFY_BACKEND_DEV

CMD ["node", "dist/index.js"]
