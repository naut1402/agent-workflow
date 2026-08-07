# syntax=docker/dockerfile:1
# Build từ root repo:
#   docker build -f docker/Dockerfile -t dev-team-dashboard:local .
# Multi-stage: Vite SPA build → Bun standalone (+ Claude/Cursor CLI, non-root).
#
# Corporate / MITM CA (optional): docker/install.sh stages host CA files +
# docker/certs/manifest.env (basenames only) into the build context. Do NOT pass
# absolute /etc/... paths as build-args — Git Bash/MSYS rewrites them to
# C:/Program Files/Git/etc/... and breaks the Linux build.

FROM oven/bun:1 AS build
WORKDIR /app

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*
COPY docker/certs/ /etc/ssl/corp-ca/
COPY docker/install-corp-ca.sh /tmp/install-corp-ca.sh
RUN chmod +x /tmp/install-corp-ca.sh \
  && /tmp/install-corp-ca.sh \
  && rm -f /tmp/install-corp-ca.sh

COPY package.json bun.lock ./
RUN if [ -f /etc/ssl/corp-ca/env.sh ]; then . /etc/ssl/corp-ca/env.sh; fi \
  && bun install --frozen-lockfile

COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src

RUN if [ -f /etc/ssl/corp-ca/env.sh ]; then . /etc/ssl/corp-ca/env.sh; fi \
  && bun run build

FROM oven/bun:1 AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    DEV_TEAM_DASHBOARD_HOST=0.0.0.0 \
    DEV_TEAM_DASHBOARD_PORT=5174 \
    DEV_TEAM_DASHBOARD_HOME=/data/dashboard-home \
    DEV_TEAM_ROOT=/data/project/.dev-team-agent \
    DEV_TEAM_BUNDLED_PLUGINS=/opt/bundled-plugins \
    HOME=/home/dashboard \
    PATH="/home/dashboard/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# Claude CLI từ chối --dangerously-skip-permissions khi chạy root — bắt buộc non-root.
# oven/bun đã chiếm uid 1000 → dùng 1001 làm user mặc định trong image.
# Runtime identity: PUID/PGID (LinuxServer-style) — xem docker/entrypoint.sh.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates git gnupg openssl \
  && rm -rf /var/lib/apt/lists/*

# Corporate CA before any further HTTPS (gh / claude.ai / cursor.com).
COPY docker/certs/ /etc/ssl/corp-ca/
COPY docker/install-corp-ca.sh /tmp/install-corp-ca.sh
RUN chmod +x /tmp/install-corp-ca.sh \
  && /tmp/install-corp-ca.sh \
  && rm -f /tmp/install-corp-ca.sh

RUN if [ -f /etc/ssl/corp-ca/env.sh ]; then . /etc/ssl/corp-ca/env.sh; fi \
  && mkdir -p -m 755 /etc/apt/keyrings \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
       -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
       > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends gh \
  && useradd --create-home --uid 1001 --shell /bin/bash dashboard \
  && mkdir -p /data/dashboard-home /data/project \
    /home/dashboard/.local/bin /home/dashboard/.local/share \
  && chown -R dashboard:dashboard /home/dashboard /data \
  && command -v gh \
  && rm -rf /var/lib/apt/lists/*

USER dashboard
ENV HOME=/home/dashboard
# bash sources BASH_ENV for non-interactive shells (claude/cursor install scripts).
ENV BASH_ENV=/etc/ssl/corp-ca/env.sh
RUN curl -fsSL https://claude.ai/install.sh | bash \
  && curl -fsS https://cursor.com/install | bash \
  && command -v claude \
  && (command -v agent || command -v cursor-agent)

USER root
COPY package.json bun.lock ./
RUN if [ -f /etc/ssl/corp-ca/env.sh ]; then . /etc/ssl/corp-ca/env.sh; fi \
  && bun install --frozen-lockfile --production

COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY docs/template/agents /opt/bundled-plugins/dev-agent-teams/agents
COPY docker/entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
  && chown -R dashboard:dashboard /app /data /home/dashboard /opt/bundled-plugins /etc/ssl/corp-ca

EXPOSE 5174

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bun", "src/standalone.ts"]
