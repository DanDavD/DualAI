# ============================================================================
# DUALAI ZERO-TRUST CLOUD GATEWAY - Production Multi-Stage Dockerfile (CARD-18)
# Minimal Node.js 22 Alpine runtime, non-root execution, /v1/health probe,
# and clean SIGTERM forwarding for graceful WebSocket shutdown.
# ============================================================================

FROM node:22-alpine AS builder

WORKDIR /app

# Install only production + TypeScript build dependencies for the Gateway
COPY package.json ./
RUN npm install --no-audit --no-fund --ignore-scripts \
    typescript \
    ws \
    @types/node \
    @types/ws \
    @google/genai \
    @paddle/paddle-node-sdk

COPY server/tsconfig.json ./server/tsconfig.json
COPY server/src ./server/src

# Compile Gateway TypeScript cleanly to server/dist/
RUN npx tsc -p server/tsconfig.json

# ----------------------------------------------------------------------------
# Production Runtime Stage (Zero build tools, non-root user, minimal footprint)
# ----------------------------------------------------------------------------
FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV GATEWAY_HOST=0.0.0.0
ENV PORT=8787

RUN addgroup -S dualai && adduser -S dualai -G dualai

# Install strictly runtime dependencies (ws, @google/genai, @paddle/paddle-node-sdk)
RUN npm init -y >/dev/null 2>&1 && \
    npm install --omit=dev --no-audit --no-fund ws @google/genai @paddle/paddle-node-sdk && \
    chown -R dualai:dualai /app

COPY --from=builder --chown=dualai:dualai /app/server/dist ./server/dist

USER dualai

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const p=process.env.PORT||process.env.GATEWAY_PORT||8787;fetch('http://127.0.0.1:'+p+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
