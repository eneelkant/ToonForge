# ToonForge production image (Apache-2.0)
# Does NOT bundle OmniChar (GPL) or ReelMimic — connect via network/env.
FROM node:22.14-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY config ./config
COPY characters ./characters
COPY docs ./docs
COPY scripts ./scripts
COPY THIRD_PARTY_NOTICES.md LICENSE README.md ./

RUN npm run build \
  && npm prune --omit=dev

ENV NODE_ENV=production \
    TOONFORGE_DATA_DIR=/data \
    YOUTUBE_DRY_RUN=true \
    OMNICHAR_ENABLED=false \
    REELMIMIC_ENABLED=false \
    PORT=3100

RUN mkdir -p /data /data/projects /data/logs /logs /generated /published \
  && chown -R node:node /app /data /logs /generated /published

USER node

VOLUME ["/data", "/logs", "/generated", "/published"]

EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('fs').accessSync('/data')" || exit 1

CMD ["node", "dist/mcp/server.js"]
