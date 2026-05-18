# ============================================================
#  ProspectSA — Production Dockerfile
#  Targets: linux/amd64 (Docker Desktop) and linux/arm64 (Oracle Cloud)
#  Builds: Node API server + Vite frontend + Python Scout sidecar
#  Browsers: Single shared Chromium for Playwright (Node + Python) + Puppeteer
# ============================================================

# BuildKit automatically picks up TARGETPLATFORM from the host or
# --platform=… on the build command line, so no explicit flag is needed
# here. To force a different target, use `docker buildx build --platform`.
FROM node:22-bookworm

# ── Shared Playwright/Puppeteer browser path ─────────────────────────────────
# All three browser consumers (Node Playwright, Python Playwright, Puppeteer)
# point at the same directory so Chromium is only downloaded once.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
# Puppeteer executable path is set dynamically in start.sh after Playwright installs Chromium

# ── System dependencies ───────────────────────────────────────────────────────
# python3.11, pip, venv: for Python Scout microservice
# Chromium system libs: required for headless Chromium on Debian Bookworm
# (libasound2 is the Bookworm name; it was renamed to libasound2t64 in
# Debian Trixie / 13 — when bumping the base image past Bookworm, update.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 \
    python3.11-venv \
    python3-pip \
    wget \
    curl \
    gnupg \
    procps \
    ca-certificates \
    fonts-liberation \
    fonts-noto-color-emoji \
    libglib2.0-0 \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcursor1 \
    libxi6 \
    libxtst6 \
    lsof \
    && rm -rf /var/lib/apt/lists/*

# ── Python virtual environment for Scout microservice ────────────────────────
ENV VIRTUAL_ENV=/opt/scout-venv
RUN python3.11 -m venv $VIRTUAL_ENV
ENV SCOUT_PYTHON="$VIRTUAL_ENV/bin/python"
ENV SCOUT_UVICORN="$VIRTUAL_ENV/bin/uvicorn"
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# ── pnpm setup ────────────────────────────────────────────────────────────────
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# ── Working directory ─────────────────────────────────────────────────────────
WORKDIR /app

# ── Copy workspace manifest files FIRST (layer cache for pnpm install) ───────
# Root workspace files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc .pnpm-approved-builds.json ./
COPY tsconfig.base.json ./

# All lib package.json files (6 packages)
COPY lib/db/package.json                          ./lib/db/
COPY lib/api-zod/package.json                     ./lib/api-zod/
COPY lib/api-client-react/package.json            ./lib/api-client-react/
COPY lib/api-spec/package.json                    ./lib/api-spec/
COPY lib/integrations-openai-ai-server/package.json ./lib/integrations-openai-ai-server/
COPY lib/integrations-openai-ai-react/package.json  ./lib/integrations-openai-ai-react/

# Artifact package.json files (api-server + prospect-sa only; skip mockup-sandbox)
COPY artifacts/api-server/package.json  ./artifacts/api-server/
COPY artifacts/prospect-sa/package.json ./artifacts/prospect-sa/

# Scripts package
COPY scripts/package.json ./scripts/

# ── Install Node.js dependencies ──────────────────────────────────────────────
# --frozen-lockfile ensures exact versions from pnpm-lock.yaml
# onlyBuiltDependencies allows esbuild/puppeteer/protobufjs native builds
RUN pnpm install --frozen-lockfile

# ── Install Playwright Chromium (shared — used by Node + Python Playwright + Puppeteer) ──
RUN npx playwright install chromium --with-deps 2>/dev/null || npx playwright install chromium

# ── Copy full source ──────────────────────────────────────────────────────────
COPY . .

# ── Install Python Scout dependencies ────────────────────────────────────────
RUN $VIRTUAL_ENV/bin/pip install --upgrade pip --quiet && \
    $VIRTUAL_ENV/bin/pip install -r artifacts/python-scout/requirements.txt --quiet

# ── Install Python Playwright and point it at shared Chromium ────────────────
RUN $VIRTUAL_ENV/bin/python -m playwright install chromium 2>/dev/null || true

# ── Build frontend (Vite → artifacts/prospect-sa/dist/public) ────────────────
RUN pnpm --filter @workspace/prospect-sa build

# ── Build backend (esbuild CJS bundle → artifacts/api-server/dist/index.cjs) ─
RUN pnpm --filter @workspace/api-server build

# ── Verify build outputs exist ────────────────────────────────────────────────
RUN test -f artifacts/api-server/dist/index.cjs || (echo "ERROR: api-server build failed" && exit 1)
RUN test -f artifacts/prospect-sa/dist/public/index.html || (echo "ERROR: frontend build failed" && exit 1)
RUN test -d artifacts/api-server/seed-data || (echo "ERROR: seed-data not copied" && exit 1)

# ── Expose ports ──────────────────────────────────────────────────────────────
# 3000: Node API server (also serves built frontend)
# 8099: Python Scout microservice
EXPOSE 3000 8099

# ── Start script ──────────────────────────────────────────────────────────────
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

CMD ["/app/start.sh"]
