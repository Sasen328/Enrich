# OrcEngine

**Multi-source research orchestrator.** Given a topic (company, person, market), OrcEngine crawls websites, aggregates news, calls an LLM to write a structured report, and exports it as HTML / PDF / PPT.

## Source

```
artifacts/api-server/src/orcengine/
├── routes.ts          HTTP layer (registerOrcEngineRoutes)
├── orchestrator.ts    Pipeline: crawl → enrich → news → report
├── crawler.ts         Recursive site crawl (Playwright)
├── scraper.ts         Single-page extraction
├── news.ts            Perplexity-backed news aggregation
├── enrichment.ts      Field-level enrichment
└── export-service.ts  HTML / PDF / PPTX generation
```

## Endpoints

| Method | Path | Notes |
|---|---|---|
| POST | `/api/orcengine/scrape` | Start scrape over a URL set → returns `{ id }` |
| GET | `/api/orcengine/scrape/:id` | Status + accumulated summary |
| POST | `/api/orcengine/scrape/:id/chat` | Conversational follow-ups grounded in the scrape |
| POST | `/api/orcengine/research` | Topic-mode research (no seed URLs) |
| POST | `/api/orcengine/export` | Render to `pdf` / `pptx` / `html` |

## Storage

- `scrape_sessions` — `urls, summary, progress, status, createdAt`
- `research_jobs` — `query, status, report, sources, findings, createdAt`

## External dependencies

| Service | Used for |
|---|---|
| OpenAI GPT-4o | Report writing, structured extraction |
| Perplexity | News + recent-events research |
| Crawl4AI | AI-friendly markdown extraction |
| Playwright | JS-rendered pages |

## Tuning

- Slow scrapes? Lower the crawler depth or enable proxy rotation (`NEXUS_PROXY_ENABLED=1`).
- PPT export uses `pptxgenjs`; PDF uses `pdfkit`. Themes live in `export-service.ts`.
