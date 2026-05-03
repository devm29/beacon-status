# syntax=docker/dockerfile:1.7
# One image recipe for every Node service: docker build --build-arg APP=api -f docker/node.Dockerfile .
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.1 --activate
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json vitest.shared.ts ./
COPY packages ./packages
COPY apps ./apps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
ARG APP
RUN pnpm --filter "@beacon/${APP}..." build \
 && pnpm --filter "@beacon/${APP}" deploy --prod /out

# Seeding and the CLI run from source with dev dependencies available.
FROM build AS tools
ENV NODE_ENV=development
CMD ["pnpm", "seed"]

FROM node:22-alpine AS runtime
ENV NODE_ENV=production LOG_FORMAT=json
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
CMD ["node", "dist/main.js"]
