# syntax=docker/dockerfile:1.7

# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: builder
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder

WORKDIR /app

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

RUN apt-get update \
  && apt-get install -y --no-install-recommends poppler-utils \
  && rm -rf /var/lib/apt/lists/*

# ── Copy manifests FIRST so npm ci is cached when only src changes ────────────
COPY package.json package-lock.json .npmrc ./

# npm cache is cached across builds via BuildKit cache mount
RUN --mount=type=cache,id=npm-hts,target=/root/.npm \
    npm ci

# ── Copy source and compile ────────────────────────────────────────────────────
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src/ ./src/

RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: runtime
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=3002
ENV HOME=/home/appuser
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV CHROME_PATH=/usr/bin/chromium

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    poppler-utils \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd --system appuser \
  && useradd --system --gid appuser --create-home --home-dir /home/appuser appuser \
  && mkdir -p /home/appuser/.cache/puppeteer /home/appuser/Downloads /tmp/chromium \
  && chown -R appuser:appuser /home/appuser /tmp/chromium

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

EXPOSE 3002

USER appuser

CMD ["node", "dist/main.js"]
