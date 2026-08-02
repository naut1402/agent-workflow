# syntax=docker/dockerfile:1
# Multi-stage: Vite SPA build → Bun standalone (+ Claude/Cursor CLI trong image).

FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src

RUN bun run build

FROM oven/bun:1 AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    DEV_TEAM_DASHBOARD_HOST=0.0.0.0 \
    DEV_TEAM_DASHBOARD_PORT=5174 \
    DEV_TEAM_DASHBOARD_HOME=/data/dashboard-home \
    DEV_TEAM_ROOT=/data/project/.dev-team-agent \
    PATH="/root/.local/bin:${PATH}"

# Runner CLI (Linux) — không dùng binary Windows từ host.
# Auth/session: mount ~/.claude và ~/.cursor từ host (xem docker-compose.runners.yml).
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates git \
  && curl -fsSL https://claude.ai/install.sh | bash \
  && curl -fsS https://cursor.com/install | bash \
  && command -v claude \
  && (command -v agent || command -v cursor-agent) \
  && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/tsconfig.json ./tsconfig.json

EXPOSE 5174

# Bind 0.0.0.0 (ENV trên) để port publish từ host tới được container.
CMD ["bun", "src/standalone.ts"]
