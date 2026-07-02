FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

FROM oven/bun:1-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

FROM oven/bun:1-alpine AS runtime
WORKDIR /app

# Tools are useful for future phases (#41/#44) but harmless for #40.
RUN apk add --no-cache git openssh-client rsync wget \
  && adduser -D -h /home/app app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
COPY mcp ./mcp
COPY package.json ./

ENV DEV_TEAM_DASHBOARD_HOST=0.0.0.0
ENV DEV_TEAM_DASHBOARD_PORT=5174

EXPOSE 5174
USER app

CMD ["bun", "server/standalone.ts"]

