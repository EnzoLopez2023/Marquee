# syntax=docker/dockerfile:1

FROM node:24-slim AS build

ARG MARQUEE_BUILD_VERSION=0.0.0-local
ARG MARQUEE_BUILD_COMMIT=local-development
ARG MARQUEE_BUILD_ID=local-development
ARG MARQUEE_BUILD_TIME=local-development

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /build

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ENV MARQUEE_BUILD_VERSION=${MARQUEE_BUILD_VERSION} \
    MARQUEE_BUILD_COMMIT=${MARQUEE_BUILD_COMMIT} \
    MARQUEE_BUILD_ID=${MARQUEE_BUILD_ID} \
    MARQUEE_BUILD_TIME=${MARQUEE_BUILD_TIME}
RUN node scripts/write-build-metadata.mjs \
  && npm run build \
  && npm prune --omit=dev \
  && npm cache clean --force

FROM node:24-slim AS runtime

ARG MARQUEE_BUILD_VERSION=0.0.0-local
ARG MARQUEE_BUILD_COMMIT=local-development
ARG MARQUEE_BUILD_ID=local-development
ARG MARQUEE_BUILD_TIME=local-development

RUN apt-get update \
  && apt-get install -y --no-install-recommends dumb-init \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 10001 marquee \
  && useradd --uid 10001 --gid marquee --no-create-home --shell /usr/sbin/nologin marquee \
  && mkdir -p /home/data/marquee-artifacts \
  && chown -R marquee:marquee /home/data

WORKDIR /app

COPY --from=build --chown=marquee:marquee /build/dist ./dist
COPY --from=build --chown=marquee:marquee /build/dist-server ./dist-server
COPY --from=build --chown=marquee:marquee /build/node_modules ./node_modules
COPY --from=build --chown=marquee:marquee /build/package.json ./package.json
COPY --from=build --chown=marquee:marquee /build/build-metadata.json ./build-metadata.json
COPY --from=build --chown=marquee:marquee /build/scripts/start-production.mjs ./scripts/start-production.mjs

ENV NODE_ENV=production \
    PORT=3001 \
    DB_PATH=/home/data/marquee.db \
    MARQUEE_ARTIFACT_ROOT=/home/data/marquee-artifacts \
    MARQUEE_BUILD_VERSION=${MARQUEE_BUILD_VERSION} \
    MARQUEE_BUILD_COMMIT=${MARQUEE_BUILD_COMMIT} \
    MARQUEE_BUILD_ID=${MARQUEE_BUILD_ID} \
    MARQUEE_BUILD_TIME=${MARQUEE_BUILD_TIME}

EXPOSE 3001
STOPSIGNAL SIGTERM

USER marquee

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "scripts/start-production.mjs"]
