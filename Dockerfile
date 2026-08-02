# syntax=docker/dockerfile:1
# Multi-stage: Vite SPA build → Bun standalone (+ Claude/Cursor CLI, non-root).

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
    HOME=/home/dashboard \
    PATH="/home/dashboard/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# Claude CLI từ chối --dangerously-skip-permissions khi chạy root — bắt buộc non-root.
# oven/bun đã chiếm uid 1000 → dùng 1001.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates git \
  && useradd --create-home --uid 1001 --shell /bin/bash dashboard \
  && mkdir -p /data/dashboard-home /data/project \
    /home/dashboard/.local/bin /home/dashboard/.local/share \
  && chown -R dashboard:dashboard /home/dashboard /data \
  && rm -rf /var/lib/apt/lists/*

# Runner CLI (Linux) — cài dưới user dashboard (HOME=~dashboard).
USER dashboard
ENV HOME=/home/dashboard
RUN curl -fsSL https://claude.ai/install.sh | bash \
  && curl -fsS https://cursor.com/install | bash \
  && command -v claude \
  && (command -v agent || command -v cursor-agent)

USER root
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
  && chown -R dashboard:dashboard /app /data /home/dashboard

EXPOSE 5174

# Entrypoint chown volume rồi drop privileges → user dashboard.
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bun", "src/standalone.ts"]
