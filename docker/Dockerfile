# syntax=docker/dockerfile:1

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

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates git gnupg openssl \
  && rm -rf /var/lib/apt/lists/*

# Tạo sớm để mọi COPY --chown=dashboard phía sau hợp lệ.
RUN useradd --create-home --uid 1001 --shell /bin/bash dashboard \
  && mkdir -p /data/dashboard-home /data/project \
    /home/dashboard/.local/bin /home/dashboard/.local/share \
    /opt/bundled-plugins/dev-agent-teams \
  && chown -R dashboard:dashboard /home/dashboard /data /opt/bundled-plugins \
  && chown dashboard:dashboard /app

# Giữ root:root — root source env.sh lúc start, nên dashboard không được là owner.
# a+rX (không chown) vì cert nguồn có thể là 0600 mà dashboard vẫn phải đọc được.
COPY docker/certs/ /etc/ssl/corp-ca/
COPY docker/install-corp-ca.sh /tmp/install-corp-ca.sh
RUN chmod +x /tmp/install-corp-ca.sh \
  && /tmp/install-corp-ca.sh \
  && rm -f /tmp/install-corp-ca.sh \
  && chmod -R a+rX /etc/ssl/corp-ca

RUN if [ -f /etc/ssl/corp-ca/env.sh ]; then . /etc/ssl/corp-ca/env.sh; fi \
  && mkdir -p -m 755 /etc/apt/keyrings \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
       -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
       > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends gh \
  && command -v gh \
  && rm -rf /var/lib/apt/lists/*

# Node cho vitest / eslint / vue-tsc chạy trên project mount ở /data/project (shebang
# `#!/usr/bin/env node`). Tag phải là `-trixie-` để khớp glibc của `oven/bun:1`.
COPY --from=node:24-trixie-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:24-trixie-slim /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
  && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
  && node --version \
  && npm --version

USER dashboard
ENV HOME=/home/dashboard
ENV BASH_ENV=/etc/ssl/corp-ca/env.sh
RUN curl -fsSL https://claude.ai/install.sh | bash \
  && curl -fsS https://cursor.com/install | bash \
  && command -v claude \
  && (command -v agent || command -v cursor-agent)

COPY --chown=dashboard:dashboard package.json bun.lock ./
RUN --mount=type=cache,id=bun-cache-runtime,target=/tmp/bun-cache,uid=1001,gid=1001 \
    if [ -f /etc/ssl/corp-ca/env.sh ]; then . /etc/ssl/corp-ca/env.sh; fi \
  && BUN_INSTALL_CACHE_DIR=/tmp/bun-cache bun install --frozen-lockfile --production

# Phải là root: entrypoint cần uid 0 cho useradd/chown/runuser (PUID/PGID).
USER root
# Không thêm RUN nào sau các COPY dưới đây — mọi lần sửa source sẽ phải chạy lại layer đó.
COPY --from=build --chown=dashboard:dashboard /app/dist ./dist
COPY --from=build --chown=dashboard:dashboard /app/src ./src
COPY --from=build --chown=dashboard:dashboard /app/tsconfig.json ./tsconfig.json
COPY --chown=dashboard:dashboard docs/template/agents /opt/bundled-plugins/dev-agent-teams/agents
COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/docker-entrypoint.sh

EXPOSE 5174

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bun", "src/standalone.ts"]
