# Crawlee (planned — orchestration)

## Role
Large-scale concurrent crawl framework (TS-native, by Apify). Adds request queue, auto-scaling, session pool, proxy rotation — the orchestration layer the current ad-hoc Playwright BFS lacks.

## When it fires
Bulk harvest jobs (AI Database Builder multi-source, Data Seeder HARVEST across 25+ pages) where throughput + retry matter.

## File
`lib/scrapers/crawlee-runner.ts` — wraps PlaywrightCrawler; integrates `proxy-pool` + existing power-scraper layers as request handlers.

## Env
Inherits `proxy-pool`; concurrency via `CRAWLEE_MAX_CONCURRENCY` (default 10).

## Notes
Chosen over Scrapy because the API server is TS — keeps everything in-process. Scrapy stays an option inside the Python Scout container for very large jobs.
