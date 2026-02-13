# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS builder

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

RUN corepack enable

# Copy source first; .dockerignore keeps build context lean.
COPY . .

# Install dependencies and build workspace packages + Nest app.
RUN pnpm install --frozen-lockfile
RUN pnpm -r build && pnpm exec nest build


FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=3002

WORKDIR /app

# Keep runtime container non-root.
RUN groupadd --system appuser && useradd --system --gid appuser appuser

# Runtime assets:
# - node_modules from builder (contains workspace links)
# - compiled app in dist/
# - workspace packages (targets for workspace symlinks)
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/packages ./packages

EXPOSE 3002

USER appuser

CMD ["node", "dist/src/main.js"]
