FROM node:24-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@10.30.1 --activate
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
COPY vendor ./vendor
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:24-bookworm-slim
ENV NODE_ENV=production APP_DATA_DIR=/data APP_HOST=0.0.0.0 APP_AUTH=required PORT=4310
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 4310
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "require('http').get({hostname:'127.0.0.1',port:process.env.PORT,path:'/api/session',headers:{host:new URL(process.env.APP_URL).host}},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "dist/server.mjs"]
