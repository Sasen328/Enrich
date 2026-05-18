# Signals

**Event-driven intelligence layer.** Detects news, sanctions, regulatory changes, and individual risk events for companies in the unified pool. Signals are scoped by `domain` so the same record is reachable from any engine that knows the company URL.

## Source

- Router: `artifacts/api-server/src/routes/signals.ts`
- Engine: `artifacts/api-server/src/lib/signal-engine.ts`

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/signals/scan` | Full scan over a company (news + sanctions + regulatory + individuals) |
| POST | `/signals/news` | News-only scan |
| POST | `/signals/sanctions` | Sanctions check (OFAC / EU / UN lists via Scout) |
| POST | `/signals/individual` | Risk events tied to a named executive |
| POST | `/signals/regulatory` | CMA / SAMA / ZATCA notices |
| GET | `/signals` | List all signals with filters |
| GET | `/signals/:companyId` | Signals for one company |
| DELETE | `/signals/:id` | Remove a stale signal |

## Storage

`company_signals` row:

| Column | Notes |
|---|---|
| `domain` | Foreign key in spirit — joined to `companies.website` |
| `category` | `positive` / `negative` / `neutral` / `mixed` |
| `title`, `summary` | Display content |
| `sourceUrl` | Citation |
| `confidence` | 0–1 score from the LLM extractor |
| `metadata` | Free-form JSON (tickers, named individuals, jurisdictions) |
| `timestamp` | Event time (may predate the scan) |

## External APIs

| Service | Used for |
|---|---|
| Perplexity | News research, source attribution |
| Scout | Sanctions list lookups, public mentions |
| Nexus router | LLM call for category + confidence scoring |

## Operational notes

- Idempotent: re-scanning a company merges new signals rather than duplicating.
- Scoring is **per-event**, not per-company — a company's overall risk is computed at read time.
- Set `DISABLE_PERPLEXITY=1` to fall back to Scout-only mode for cost control.
