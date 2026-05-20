# AI Chat — Architecture & Provider Routing

## Two layers

```
┌──────────────────────────────────────────────────────────────────────┐
│  ORCHESTRATOR (one and only one)                                     │
│  Anthropic Claude — Sonnet 4.6 by default                            │
│  Why Claude here?                                                    │
│    • Anthropic's `messages.create` is the SDK we use for the         │
│      iterative tool-use loop. Gemini/OpenAI also have function-      │
│      calling but the loop semantics + privacy are simplest with one  │
│      orchestrator framework.                                         │
│    • Override anytime: AI_CHAT_ORCHESTRATOR_MODEL=claude-haiku-4-5   │
│      gives ~100× cheaper turns when quality is less critical.        │
└──────────────────────────────────────────────────────────────────────┘
            │ picks one of 9 tools per turn
            ▼
┌──────────────────────────────────────────────────────────────────────┐
│  TOOLS (orchestrator can use all of these in any combination)        │
│                                                                      │
│  nexus_run(role, task)  ──►  NEXUS router (every other LLM)          │
│                              ├ Anthropic (Claude — synthesis tier)   │
│                              ├ OpenAI (GPT-4o, GPT-4o-mini)          │
│                              ├ Gemini (2.5 Flash — arabic tier)      │
│                              ├ Groq (Llama 3.3 70B — realtime tier)  │
│                              ├ DeepSeek native (cheap extraction)    │
│                              ├ Kimi / Moonshot (arabic specialist)   │
│                              ├ Perplexity native (live web)          │
│                              ├ Ollama / Llama (local, bulk)          │
│                              └ OpenRouter (catch-all fallback +      │
│                                            :free model variants)     │
│                                                                      │
│  web_search(query)      ──►  Tavily → SearXNG → Google HTML          │
│  url_crawl(url)         ──►  Axios + Cheerio (static, fast)          │
│  deep_scrape(url)       ──►  Playwright + stealth (JS-heavy)         │
│  harvester_run(query)   ──►  Multi-source façade:                    │
│                                GLEIF · OpenCorporates · Wikidata ·   │
│                                Google News · Saudi RSS · Scout       │
│  sanctions_screen(name) ──►  OFAC + UN + EU + OpenSanctions          │
│  scout_osint(query)     ──►  Python Scout (Sherlock + multi-source)  │
│  lead_factory_run(...)  ──►  Full 7-agent pipeline                   │
│  signal_monitor(co)     ──►  Buying-signal scanner                   │
└──────────────────────────────────────────────────────────────────────┘
```

## Why Claude as the orchestrator (and not Gemini/GPT)

We picked one orchestration framework so the SSE event shape, retry, and
privacy stripping stay consistent. Anthropic's tool-use API + the
`@anthropic-ai/sdk` already in our `package.json` make this the lowest-
friction choice. The orchestrator is the only Claude-bound layer; *every
other model* is reachable through `nexus_run`, including Gemini.

## When is Gemini / Groq / Ollama actually used?

The orchestrator delegates to them via `nexus_run`:

```json
{ "tool": "nexus_run", "input": { "role": "arabic", "task": "..." } }
```

| role        | NEXUS tier   | first-pick model                              |
|-------------|--------------|-----------------------------------------------|
| planner     | synthesis    | Claude Sonnet 4.6 (or DeepSeek R1 if :free)   |
| researcher  | realtime     | **Perplexity Sonar** (live web) → Groq        |
| extractor   | extraction   | **DeepSeek V3** native → Gemini 2.5 Flash     |
| arabic      | arabic       | **Kimi / Moonshot** → Qwen → Gemini           |
| writer      | synthesis    | Claude Sonnet / Gemini / GPT-4o               |
| validator   | bulk         | DeepSeek → Ollama → Groq Llama                |
| bulk        | bulk         | Ollama / Llama 3.1 8B (local, free)           |
| signal      | extraction   | DeepSeek → Gemini Flash                       |
| tree        | extraction   | DeepSeek → Gemini Flash                       |

So Gemini, Groq, Ollama, Llama, Kimi, DeepSeek are **all live in the
loop** — they just sit one layer below the Claude orchestrator.

## API keys — what's required vs optional

| Env var                  | Status     | Effect when missing                    |
|--------------------------|------------|----------------------------------------|
| `ANTHROPIC_API_KEY`      | **REQUIRED** | Orchestrator can't start; route returns clear error event |
| `OPENROUTER_API_KEY`     | recommended| Loses universal fallback chain         |
| `OPENAI_API_KEY`         | optional   | Skip GPT-4o tier                       |
| `GEMINI_API_KEY`         | optional   | Skip Gemini (arabic+grounded)          |
| `GROQ_API_KEY`           | optional   | Skip realtime tier                     |
| `PERPLEXITY_API_KEY`     | optional   | Skip native; falls back to OR proxy    |
| `DEEPSEEK_API_KEY`       | optional   | Skip native; falls back to OR proxy    |
| `MOONSHOT_API_KEY`       | optional   | Skip native Kimi; falls back to Qwen   |
| `TAVILY_API_KEY`         | recommended| `web_search` falls back to SearXNG + Google HTML |
| `NEXUS_PREFER_FREE_MODELS=true` | optional | Prepend OpenRouter `:free` to every tier |

### Native keys vs OpenRouter — why both?

You DON'T need native keys. OpenRouter proxies all of them. Reasons to
add native keys anyway:

* **DeepSeek native** = $0.27/MTok vs $0.55 via OpenRouter (50% cheaper)
* **Kimi / Moonshot** = better Arabic results than the OpenRouter Qwen route
* **Perplexity native** = unlocks `sonar` live-web models OpenRouter doesn't proxy

All native adapters are wired in `artifacts/api-server/src/lib/nexus/llm-router.ts`.

## The engines that DO scraping/crawling/intel

Each is exposed as an explicit agent tool so the orchestrator can call
them directly (and you see them in the SSE breadcrumbs):

| Tool                | Backed by                                                                        |
|---------------------|----------------------------------------------------------------------------------|
| `web_search`        | `lib/free-search.ts` (Tavily → SearXNG → Google HTML waterfall)                  |
| `url_crawl`         | axios + lightweight HTML strip                                                   |
| `deep_scrape`       | `lib/power-scraper.ts` (Playwright + stealth)                                    |
| `harvester_run`     | `lib/harvester/index.ts` (unified façade: GLEIF · OpenCorporates · Wikidata · sanctions · Saudi RSS · Scout site-intel) |
| `sanctions_screen`  | `lib/sanctions-screen.ts` (OFAC SDN · UN · EU · OpenSanctions XML feeds)         |
| `scout_osint`       | Python Scout sidecar (FastAPI + Sherlock + Crawl4AI + Playwright)                |
| `lead_factory_run`  | `lib/lead-factory-engine.ts` (7-agent pipeline)                                  |
| `signal_monitor`    | Harvester façade scoped to last-90-day signal terms                              |

## Privacy guarantee

The SSE stream emits only friendly labels (`🔍 Researcher`, `🎭 Playwright`,
`🛰️ Harvester` …). Provider/model names live in server logs only — set
`LOG_LEVEL=debug` to see them.

## When to override the orchestrator model

```bash
# cheap mode — 100× cheaper but less reasoning depth
AI_CHAT_ORCHESTRATOR_MODEL=claude-haiku-4-5

# experimental Opus mode for very hard research questions
AI_CHAT_ORCHESTRATOR_MODEL=claude-opus-4-7
```
