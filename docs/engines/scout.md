# Scout

**OSINT microservice for site intelligence and contact discovery.** Runs as a separate Python FastAPI process; the Node API server proxies through `lib/scout-client.ts`.

## Source

- TypeScript proxy: `artifacts/api-server/src/routes/scout.ts`, `artifacts/api-server/src/lib/scout-client.ts`
- Python service: `artifacts/python-scout/` (FastAPI + Playwright + Scrapy + BeautifulSoup)

## Endpoints

All under `/api/scout/*`. The Node side just forwards to `${SCOUT_URL}/...`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/scout/health` | Confirms the Python service is up |
| POST | `/scout/site-intel` | Tech stack, social handles, emails, phones from a single domain |
| POST | `/scout/osint/harvest` | Sweep emails + social profiles across the open web |
| POST | `/scout/osint/social` | Resolve a name to LinkedIn / Twitter / etc. |
| POST | `/scout/ai-extract` | Run an LLM extractor over scraped HTML |
| POST | `/scout/full-scan` | Site-intel + OSINT + subdomain enumeration in one call |

## Config

| Env | Default | Notes |
|---|---|---|
| `SCOUT_URL` | `http://localhost:8099` | Where the Python service listens |
| `CHROMIUM_EXECUTABLE_PATH` | – | Override for Nix/Replit Chromium |

## Run locally

```bash
cd artifacts/python-scout
uv sync
uv run uvicorn main:app --port 8099
```

## Persistence

None. Scout is read-only — results are returned in the HTTP response and the caller decides what to persist.

## Consumed by

- **Lead Factory** (contact + email extraction)
- **Signals** (sanctions, public mentions)
- **Company Intel** (site scraping)
- **Person Intel** (social OSINT)
