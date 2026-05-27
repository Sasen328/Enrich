# Nexus LLM Framework

How ProspectSA routes every AI call. The Nexus router (`artifacts/api-server/src/lib/nexus/llm-router.ts`) is a single entry point — `nexusGenerate(prompt, { tier })` — that picks the cheapest reachable model for the task and falls through a chain on failure. No engine should call a provider SDK directly; everything goes through a **role** → **tier** → **provider chain**.

---

## 1 · Roles (what the caller asks for)

Defined in `lib/nexus/roles.ts`. An engine names a *role*; Nexus maps it to a *tier*.

| Role | Tier | System prompt intent | Used by |
|---|---|---|---|
| `planner` | synthesis | decompose query → sub-tasks (JSON) | AI Chat, Swarm, Behavior Agent |
| `researcher` | realtime | live-web fact extraction w/ source URLs | ProsEngine, Signals |
| `extractor` | extraction | parse fields → strict JSON | all enrichment, Masaar Agent 1b |
| `arabic` | arabic | AR↔EN bilingual analysis | Masaar, Arabic sources |
| `writer` | synthesis | final cited report blocks | Company/Person Intel, Masaar Agent 5 |
| `validator` | bulk | pass/warn/reject lead/company | lead-gate, company-gate |
| `bulk` | bulk | mass classification, label-only | dedup, scoring loops |
| `signal` | extraction | buying-signal JSON | Signal Intelligence |
| `tree` | extraction | org-relationship nodes/edges | Relationship Intelligence |

Call it: `nexusRunRole("extractor", prompt)`.

---

## 2 · Tiers → provider fallback chains

Five tiers. Each is an ordered list — Nexus tries top-to-bottom, skipping any provider whose key is unset, until one returns. `NEXUS_PREFER_FREE_MODELS=true` prepends OpenRouter `:free` variants.

### extraction (parse fields, classify, normalise)
1. OpenRouter `deepseek-chat-v3-0324:free` *(if PREFER_FREE)*
2. OpenRouter `llama-3.3-70b-instruct:free` *(if PREFER_FREE)*
3. DeepSeek native `deepseek-chat`
4. OpenRouter `deepseek/deepseek-chat`
5. Groq `llama-3.3-70b-versatile`
6. OpenRouter `qwen/qwen-2.5-72b-instruct`
7. Gemini `gemini-2.5-flash`
8. OpenAI `gpt-4o-mini`

### arabic (bilingual)
1. OpenRouter `qwen-2.5-72b:free`, `deepseek-v3:free` *(if PREFER_FREE)*
2. **Kimi `kimi-k2-0905-preview`** ← strongest Arabic
3. Groq `canopylabs/orpheus-arabic-saudi` ← dedicated Saudi Arabic
4. OpenRouter `qwen/qwen-2.5-72b-instruct`
5. Gemini `gemini-2.5-flash`
6. OpenRouter `deepseek/deepseek-chat`
7. Groq `llama-3.3-70b-versatile`

### realtime (< 2 s, live-web)
1. OpenRouter `llama-3.3-70b:free` *(if PREFER_FREE)*
2. **Perplexity `llama-3.1-sonar-large-128k-online`** ← live web
3. Groq `llama-3.3-70b-versatile` ← 800 tok/s
4. OpenRouter `deepseek/deepseek-chat`
5. Gemini `gemini-2.5-flash`

### bulk (high-volume, cost-first, can be slow)
1. OpenRouter `deepseek-v3:free`, `llama-3.3-70b:free` *(if PREFER_FREE)*
2. **Ollama local** `OLLAMA_MODEL` ← zero-cost
3. DeepSeek native `deepseek-chat`
4. OpenRouter `deepseek/deepseek-chat-v3-5`
5. Groq `llama-3.1-8b-instant`

### synthesis (final dossier, complex reasoning)
1. OpenRouter `deepseek-r1:free` *(if PREFER_FREE)*
2. Gemini `gemini-2.5-flash`
3. **Anthropic `claude-sonnet-4-5`** ← frontier reasoning
4. OpenAI `gpt-4o`
5. OpenRouter `deepseek/deepseek-chat-v3-5`

---

## 3 · Model shifting (escalation / de-escalation)

Nexus shifts **automatically on failure** (timeout, 4xx/5xx, empty result) by walking down the chain. Beyond that, callers can force direction:

- **Escalate UP** (cheap → frontier): pass `forceProvider: "anthropic"` or header `X-Nexus-Tier: synthesis`. Triggers we wire in:
  - request expects > 4 k output → bump to synthesis tier
  - fusion arbiter detects two cheap models disagree (§4)
  - user toggles "Show trace" / "Deep dive" mode in Composer
- **De-escalate DOWN** (frontier → cheap): header `X-Nexus-Tier: bulk` or `X-Budget: true`.
  - task tagged `bulk`/`validator`
  - `NEXUS_PREFER_FREE_MODELS=true`

Every response carries `X-Provider-Used` and, if it fell through, `X-Shifted-From`, so the UI can show `degraded_mode`.

---

## 4 · Fusion (OpenRouter ensemble) — `nexusFusion()`

For high-stakes extraction where one cheap model is risky but frontier is overkill:

```
nexusFusion("extractor", prompt, {
  models: ["deepseek-v3", "llama-3.3-70b"],   // run in parallel via OpenRouter
  arbitrator: "claude",                        // Claude resolves conflicts
})
```

Strategy: run the N cheap models concurrently → if they agree, return the consensus (cost ≈ 2× cheap); if they disagree, hand both answers to the arbitrator (Claude) to pick/merge. Latency budget configurable; defaults to first-valid-JSON when arbiter is unset.

---

## 5 · Reasoning mode

Pass `X-Reasoning-Mode: extended` to prefer models with chain-of-thought:
- synthesis tier → DeepSeek-R1 (native reasoning) or Claude extended thinking
- extraction/bulk → reasoning disabled (waste of tokens)

Per-provider reasoning support is documented in each provider file in this folder.

---

## 6 · Env vars (all optional except one of {Anthropic, OpenRouter})

`ANTHROPIC_API_KEY` · `OPENROUTER_API_KEY` · `OPENAI_API_KEY` · `GEMINI_API_KEY` · `GROQ_API_KEY` · `PERPLEXITY_API_KEY` · `DEEPSEEK_API_KEY` · `MOONSHOT_API_KEY`|`KIMI_API_KEY` · `OLLAMA_BASE_URL`+`OLLAMA_MODEL` · `NEXUS_PREFER_FREE_MODELS` · `AI_CHAT_ORCHESTRATOR_MODEL`.

See each provider's file in this directory for role bindings, costs, reasoning support, and Arabic capability.
