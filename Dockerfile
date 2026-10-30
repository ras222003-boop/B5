# Independent Basira staging container. Never include local/private model data
# or App Store signing material. Build with a verified Git commit SHA.
FROM node:24-bookworm-slim

WORKDIR /app
RUN npm install --global pnpm@10.18.1

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
RUN pnpm rebuild esbuild @tailwindcss/oxide sharp

COPY client ./client
COPY server ./server
COPY shared ./shared
COPY scripts ./scripts
COPY ios/DepthCalibrationLab/DepthCalibrationLab/BasiraFeatureCatalogue.swift \
     ./ios/DepthCalibrationLab/DepthCalibrationLab/BasiraFeatureCatalogue.swift
COPY tsconfig.json tsconfig.node.json vite.config.ts ./

# The release contract must identify a known immutable checkout.
# This is a public source SHA, never a credential.
ARG BASIRA_SOURCE_SHA
ARG RENDER_GIT_COMMIT
RUN set -eu; \
  sha="${RENDER_GIT_COMMIT:-${BASIRA_SOURCE_SHA:-}}"; \
  printf '%s' "$sha" | grep -Eq '^[0-9a-f]{40}$' \
    || (echo 'Supply RENDER_GIT_COMMIT or BASIRA_SOURCE_SHA as a complete Git commit SHA' >&2; exit 1); \
  if [ -n "${RENDER_GIT_COMMIT:-}" ] && [ -n "${BASIRA_SOURCE_SHA:-}" ] && [ "$RENDER_GIT_COMMIT" != "$BASIRA_SOURCE_SHA" ]; then \
    echo 'Render and explicit source SHAs disagree' >&2; exit 1; \
  fi; \
  BASIRA_SOURCE_SHA="$sha" pnpm build; \
  pnpm prune --prod

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000
CMD ["node", "dist/index.js"]
