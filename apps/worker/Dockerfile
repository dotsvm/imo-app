# The worker (apps/worker): one long-running Node process beside the web app.
# Build from the repo root: docker build -f apps/worker/Dockerfile .
# It needs the same environment as the web app, minus NEXT_PUBLIC_*.
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
# Workspace manifests first, so dependency installs cache across code changes.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/venues/package.json packages/venues/
COPY packages/domain/package.json packages/domain/
COPY packages/server/package.json packages/server/
COPY apps/worker/package.json apps/worker/
RUN npm ci --include=dev --workspace @imo/worker --include-workspace-root=false && npm cache clean --force
COPY packages packages
COPY apps/worker apps/worker
USER node
WORKDIR /app/apps/worker
# SIGTERM finishes lanes in flight and hands leases back (25 s at most).
# Node runs as the main process (tsx as its loader), so the signal reaches it.
STOPSIGNAL SIGTERM
CMD ["node", "--import", "tsx", "src/main.ts"]
