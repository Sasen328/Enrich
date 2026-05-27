# Native Web Engine — Scraper Fabric

ProspectSA never relies on a single scraping technique. `lib/power-scraper.ts` is an **escalating waterfall** — cheapest/fastest first, heaviest last. Each layer only fires if the previous one returned too little.

## Layer waterfall (current → planned)
```
L1  Cheerio + axios          fast static HTML            (lib/power-scraper.ts)
L2  Playwright + stealth      full JS render              (lib/stealth-browser.ts)
L3  Camoufox + Playwright     engine-level anti-detect    ← PLANNED (lib/scrapers/camoufox-runner.ts)
L4  ScrapeGraphAI             natural-language extraction ← PLANNED (lib/scrapers/scrapegraph-client.ts)
L5  BeautifulSoup subprocess  RTL / malformed HTML        (bs4_extract.py via child_process)
```

## Supporting engines
- `crawl4ai-engine.ts` — page → LLM-ready markdown, pagination, email/phone extraction.
- `orcengine/crawler.ts` — multi-page BFS (about > team > contact > news priority).
- `lib/scout-client.ts` — HTTP boundary to the Python Scout microservice (`SCOUT_URL`) hosting BeautifulSoup + OSINT tools.
- `lib/web-seeder.ts` — multi-page company crawl used by Website/Company/Person Intel.

## Planned OSINT + orchestration additions
- `sherlock-client.ts` — username enumeration across 400+ social sites.
- `theharvester-client.ts` — email/subdomain OSINT from search engines + PGP.
- `crawlee-runner.ts` — large-scale concurrent crawl with auto-scaling + queue.
- `proxy-pool.ts` — IPRoyal / LunaProxy / WebShare rotation (per-request or sticky).

## CAPTCHA
`stealth-browser.ts` solves via Claude Vision (primary) → manual override (`POST /api/masaar/captcha/:jobId`) → session-cookie skip. Optional paid solvers gated behind `NEXUS_CAPTCHA_ENABLED` (CapMonster / AZcaptcha / DeathByCaptcha / NopeCHA).

## Source enforcement
Which sites each engine harvests is governed by the **harvest source registry** (`harvest_sources` table + `/api/sources/*`). See `docs/scrapers/proxy-pool.md` and the plan's §11A. Engines read `requiredIds`/`excludedIds` at job start.
