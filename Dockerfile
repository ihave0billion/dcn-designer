# Build the static renderer, then ship it with the API server.
# The server itself needs no build step — Node 26 strips the TypeScript natively.

FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:web

FROM node:26-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV DCN_WORKSPACE=/data
ENV PORT=8788

# Only `yaml` and `adm-zip` are needed at runtime — everything else in the dependency
# list belongs to the renderer and is already baked into the static bundle. Both are
# dependency-free, so copying them from the build stage keeps the exact lockfile
# versions without shipping the other ~500MB of build tooling.
COPY package.json ./
COPY --from=build /app/node_modules/yaml ./node_modules/yaml
COPY --from=build /app/node_modules/adm-zip ./node_modules/adm-zip

COPY --from=build /app/out/web ./out/web
COPY src/server ./src/server
COPY src/preload/types.ts ./src/preload/types.ts
COPY seed ./seed

EXPOSE 8788

# Workspace lives on a bind mount so designs survive image rebuilds.
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8788/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server/index.ts"]
