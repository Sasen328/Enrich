# Environment Variables

All vars are read via `process.env.*` (TypeScript) or `os.environ[*]` (Python Scout). Set them in `.env` at the repo root (or via your host's secret store).

## Required

| Var | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string. Drizzle uses this. |
| `PORT` | API server port. No default — must be set. |

At least one LLM provider key is also required for most engines to function.

## Security & lifecycle

| Var | Default | Purpose |
|---|---|---|
| `API_TOKEN` | – | Bearer token required on every `/api/*` call except `/healthz` and `/readyz`. **Unset = no auth** (dev convenience; never deploy unset). Use a long random value, e.g. `openssl rand -hex 32`. |
| `FRONTEND_ORIGIN` | – | Comma-separated allowed CORS origins. **Unset = "*"** with a startup warning. Set to `https://app.example.com` (or a list) before production. |
| `SHUTDOWN_GRACE_MS` | `15000` | Milliseconds to wait for in-flight requests to drain on SIGTERM/SIGINT before forcing exit. |

### Frontend-side env (Vite)

Set in `artifacts/prospect-sa/.env.local`:

| Var | Purpose |
|---|---|
| `VITE_API_TOKEN` | Must match the backend's `API_TOKEN`. Injected into the Authorization header by the generated client at startup. Leave unset if the backend is running without auth. |

## LLM providers

| Var | Used by |
|---|---|
| `OPENAI_API_KEY` | Direct OpenAI (GPT-4o, used heavily by OrcEngine, Builder) |
| `ANTHROPIC_API_KEY` | Direct Anthropic (Claude Sonnet, Nexus router default) |
| `AI_INTEGRATIONS_OPENAI_API_KEY` + `AI_INTEGRATIONS_OPENAI_BASE_URL` | Optional OpenAI proxy (e.g. internal gateway) — `lib/config/env.ts` falls back to direct keys if unset |
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY` + `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` | Optional Anthropic proxy |
| `GEMINI_API_KEY` | Google Gemini (Nexus waterfall) |
| `GROQ_API_KEY` | Groq fast inference (Nexus waterfall) |
| `OPENROUTER_API_KEY` | OpenRouter aggregator (Nexus fallback) — use with `NEXUS_PREFER_FREE_MODELS=true` to prefer `:free` model variants (DeepSeek-V3, R1, Llama 3.3, Qwen) in every tier before falling back to paid endpoints. Rate-limited but zero cost. |
| `NEXUS_PREFER_FREE_MODELS` | When `true`, Nexus tries OpenRouter `:free` model IDs before any paid provider in every tier. Requires `OPENROUTER_API_KEY`. |
| `HUGGING_FACE_API_KEY` | HuggingFace models |
| `PERPLEXITY_API_KEY` | Web research — Signals, Lead Factory, Person Intel, Company Intel |
| `DISABLE_PERPLEXITY` | Force-disable Perplexity even if key is set |
| `OLLAMA_BASE_URL` + `OLLAMA_MODEL` | Local Ollama (Nexus last-resort) |

## Contact-data APIs

| Var | Purpose |
|---|---|
| `APOLLO_API_KEY`, `APOLLO_CLIENT_SECRET`, `APOLLO_ACCESS_TOKEN` | Apollo.io contact DB — Lead Factory, Person Intel |
| `HUNTER_API_KEY` | Hunter.io email finder — Lead Factory |
| `EXPLORIUM_API_KEY` | Explorium firmographics |
| `WAPPALYZER_API_KEY` | Tech-stack detection |

## Scraping & proxies

| Var | Purpose |
|---|---|
| `SCOUT_URL` | Python Scout microservice endpoint (default `http://localhost:8099`) |
| `TAVILY_API_KEY` | Tavily search API. Free dev tier (1000 queries / month). Preferred backend in `lib/free-search.ts` and used by the `tavily-mcp` server in `.mcp.json`. |
| `SEARXNG_URL` | Primary SearXNG endpoint (e.g. `https://searx.be`) for free web-search discovery in Lead Factory. |
| `SEARXNG_INSTANCES` | Comma-separated SearXNG fallback list; rotates on rate-limit or failure. |
| `FREE_SEARCH_USER_AGENT` | Override the User-Agent used by the free-search client (recommended when scraping Google HTML). |
| `APIFY_API_KEY` | Apify managed scraping |
| `CHROMIUM_EXECUTABLE_PATH` | Override Playwright Chromium binary path (Nix / non-standard installs) |
| `IPROYAL_USER`, `IPROYAL_PASS`, `IPROYAL_ENDPOINT` | IPRoyal residential proxy |
| `LUNAPROXY_USER`, `LUNAPROXY_PASS`, `LUNAPROXY_ENDPOINT` | Luna proxy |
| `SIMPLYNODE_USER`, `SIMPLYNODE_PASS`, `SIMPLYNODE_ENDPOINT` | SimplyNode proxy |
| `WEBSHARE_PROXY_LIST` | Newline-separated Webshare proxy list |
| `NEXUS_PROXY_ENABLED` | Master toggle for the Nexus proxy mesh |

## Captcha solving

Any one of these unblocks the Masaar captcha flow:

| Var |
|---|
| `CAPMONSTER_API_KEY` |
| `AZCAPTCHA_API_KEY` |
| `DEATHBYCAPTCHA_USER` + `DEATHBYCAPTCHA_PASS` |
| `NOPECHA_API_KEY` |
| `NEXUS_CAPTCHA_ENABLED` (master toggle) |

## Automation (Activepieces)

| Var |
|---|
| `ACTIVEPIECES_URL` |
| `ACTIVEPIECES_API_KEY` |
| `ACTIVEPIECES_FLOW_BUILDER` |
| `ACTIVEPIECES_FLOW_LEAD_FACTORY` |
| `ACTIVEPIECES_FLOW_MASAAR` |
| `ACTIVEPIECES_FLOW_PROSPENGINE` |
| `ACTIVEPIECES_FLOW_SIGNAL_PUSH` |

## Deployment / runtime

| Var | Purpose |
|---|---|
| `NODE_ENV` | `development` / `production` |
| `BASE_PATH` | URL base path (when the frontend is mounted under a subpath) |
