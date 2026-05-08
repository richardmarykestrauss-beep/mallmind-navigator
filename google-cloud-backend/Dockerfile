# ─────────────────────────────────────────────────────────────────────────────
# MallMind Cloud Run Backend — Dockerfile
# Multi-stage build: compile TypeScript in builder, run minimal image
# ─────────────────────────────────────────────────────────────────────────────

# Stage 1 — Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files and install ALL dependencies (including devDeps for tsc)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and compile
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Stage 2 — Production image
FROM node:20-alpine AS runner

WORKDIR /app

# Copy only production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Cloud Run expects the container to listen on $PORT (default 8080)
ENV PORT=8080
ENV NODE_ENV=production

# Do NOT bake secrets into the image.
# Inject SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY
# via Cloud Run environment variables or Secret Manager references.

EXPOSE 8080

CMD ["node", "dist/server.js"]
