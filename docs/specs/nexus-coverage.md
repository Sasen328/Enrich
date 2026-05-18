# Nexus Coverage Audit — Where the LLM/Scraper Engine Reaches

**Audited:** 2026-05-18 against `main`.

## TL;DR

Nexus is wired as the **LLM router** for every active engine — but it is **not** a unified "scraper engine." Scraping is still split across Playwright/Puppeteer/Cheerio call sites in individual engines, plus the Python Scout sidecar. Nexus's `proxy-manager.ts` and `captcha-solver.ts` are the closest thing to a shared scraper substrate.

## What Nexus actually does today

`artifacts/api-server/src/lib/nexus/` has four concerns:

| File | Purpose |
|---|---|
| `index.ts` | Re-export surface (`nexusGenerate`, `nexusSynthesize`, etc.) |
| `llm-router.ts` | Tier-based LLM waterfall (extraction / arabic / realtime / bulk / synthesis). OpenRouter `:free` prepended when `NEXUS_PREFER_FREE_MODELS=true`. |
| `proxy-manager.ts` | Proxy mesh (IPRoyal / Luna / SimplyNode / Webshare) gated by `NEXUS_PROXY_ENABLED`. |
| `captcha-solver.ts` | CapMonster / AZCaptcha / DeathByCaptcha / NopeCha gated by `NEXUS_CAPTCHA_ENABLED`. |
| `session-manager.ts` | Stealth-browser session pooling. |

So Nexus = LLM router **+** proxy mesh **+** captcha solver **+** session manager. **Scraping itself is per-engine.**

## Per-engine LLM coverage

| Engine | Nexus calls | Direct LLM calls | Status |
|---|---|---|---|
| **lead-factory-engine.ts** | 4 (now 5 after free-search) | **0** | ✅ Fully migrated |
| **relationship-intel-engine.ts** | 2 | 0 | ✅ Fully migrated |
| **signal-engine.ts** | 2 | 0 | ✅ Fully migrated |
| **signal-monitor.ts** | 2 | 0 | ✅ Fully migrated |
| **orcengine/research.ts** | 2 | (delegated) | ✅ |
| **orcengine/enrichment.ts** | 3 | (delegated) | ✅ |
| **orcengine/ai-orchestrator.ts** | 3 | (delegated) | ✅ |
| **power-scraper.ts** | 2 | 0 | ✅ |
| **masaar-engine.ts** | 2 | **9** | ⚠ Partial — direct calls remain |
| **enrichment-engine.ts** | 2 | **5** | ⚠ Partial — direct calls remain |
| **builder-engine.ts** | 0 | 0 | n/a — no LLM calls (deterministic harvest) |

✅ Means every model-touching path goes through `nexusGenerate` / `nexusSynthesize`.
⚠ Means some paths still call `anthropic.*` / `openai.chat.*` / `generateContent(...)` directly.

## Per-engine scraping coverage

Scraping is **not** Nexus-routed. It uses:

| Tool | Where |
|---|---|
| Playwright via `stealth-browser.ts` | masaar-engine, builder-engine, masar-harvester, mooresrowland-scraper |
| Puppeteer | power-scraper.ts |
| Cheerio + axios | free-sources.ts, bluepages-scraper.ts, free-search.ts (new), most RSS harvesters |
| Python Scout (FastAPI sidecar) | scout-client.ts → all engines that need deep OSINT |
| Proxy mesh (Nexus) | injected per-request **only** when `NEXUS_PROXY_ENABLED=true` |
| Captcha (Nexus) | injected per-request **only** when `NEXUS_CAPTCHA_ENABLED=true` |

So scraping shares Nexus's *infrastructure helpers* (proxies, captchas, sessions) but every engine still owns its own scrape loop.

## Specifically for Lead Factory

Per `lead-factory-engine.ts`:

| Concern | Implementation |
|---|---|
| LLM calls (7 agents × N steps) | 100% Nexus |
| Free web search discovery | New `free-search.ts` → SearXNG → Google HTML → Nexus extraction tier |
| Perplexity discovery | Falls back to free-search when no key |
| GLEIF / OpenCorporates / Wikidata / Tadawul / Bluepages / Maroof / Argaam / ArabNews | axios + cheerio, no Nexus |
| Scout enrichment | scout-client.ts → Python sidecar |
| Playwright-driven scrapes | stealth-browser.ts → Nexus proxy mesh when `NEXUS_PROXY_ENABLED=true` |
| Captcha (Masaar, mc.gov.sa) | Nexus captcha-solver |

**Bottom line for Lead Factory:** every LLM token and every web-search hit is Nexus-routed today. With `NEXUS_PREFER_FREE_MODELS=true` + `SEARXNG_URL` set, the entire Lead Factory discovery+scoring loop runs at $0 (rate-limited by free providers, not paid).

## Gaps worth closing

1. **`masaar-engine.ts` and `enrichment-engine.ts`** still have direct LLM calls (14 between them). These are leftovers from before the Nexus migration. Each one should be re-pointed at `nexusGenerate` with the appropriate tier — small change, mostly mechanical.
2. **`builder-engine.ts`** doesn't use LLMs but doesn't use Nexus's proxy/captcha helpers either. If you want every scrape to share the proxy mesh, builder needs a small refactor.
3. **No unified "scraper engine."** If we wanted Nexus to *own* scraping (one entrypoint that takes a URL + intent and routes to the right scraper), we'd need to introduce `nexusScrape()` that wraps power-scraper / stealth-browser / scout / cheerio under one signature. That's a real refactor — not free, not done.

## Recommendation

- Treat Nexus as **LLM router + infrastructure helpers**, not a single scraper. The latter would be a 2–3 day refactor for marginal benefit; the current per-engine ownership lets each engine pick its scrape strategy.
- Close the 14 direct LLM calls in Masaar + Enrichment when you next touch those engines.
- Keep using `NEXUS_PREFER_FREE_MODELS=true` + `SEARXNG_URL` to drive marginal cost toward zero.
