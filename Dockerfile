# ── Build ────────────────────────────────────────────────────────────
FROM node:22-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@11
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

COPY apps ./apps
RUN pnpm --filter @roganizo/web build \
  && pnpm --filter @roganizo/server build \
  && pnpm --filter @roganizo/server --prod deploy --legacy /out/server \
  && mkdir -p /out/web && cp -r apps/web/dist /out/web/dist

# ── Runtime ──────────────────────────────────────────────────────────
FROM node:22-slim
WORKDIR /app
COPY --from=build /out /app

ENV NODE_ENV=production
ENV DATABASE_PATH=/data/roganizo.db
ENV PORT=8080
VOLUME /data
EXPOSE 8080

CMD ["node", "server/dist/index.js"]
