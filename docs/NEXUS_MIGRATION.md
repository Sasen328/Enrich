# Nexus Migration Plan

**Goal:** Route every LLM call in the API server through the Nexus router (`lib/nexus/index.ts`) instead of instantiating provider SDKs directly. This gives one waterfall (OpenRouter → DeepSeek → Groq → Mistral → Qwen → Gemini → Claude → GPT-4o → Ollama), one cost model, one usage tally.

This document is the migration audit. No code has been changed yet.

## Nexus API surface

From `lib/nexus/index.ts`:

| Call | When to use | Tier waterfall |
|---|---|---|
| `nexusExtract(text, instruction)` | Cheap structured extraction (JSON parsing, field pulls) | DeepSeek V3 → Groq Llama → Mistral |
| `nexusRealtime(prompt)` | Latency-sensitive (chat, autocomplete) | Groq Llama (fastest) |
| `nexusGenerate(prompt, { tier })` | General generation. Tiers: `cheap`, `arabic`, `reasoning`, `frontier`. | Per tier |
| `nexusSynthesize(data, instruction)` | Final report / dossier writing | Gemini 2.5 → Claude Sonnet → GPT-4o |

All return `{ text, model, provider, costUSD, tokensIn, tokensOut }`.

**Not yet supported by Nexus** (verify before migrating):
- Streaming (SSE) — `nexusGenerate` is request/response only.
- Function/tool calling.
- Vision inputs.
- JSON-mode constraint (you get a string back; parse defensively).

## Migration table

Status legend: ✓ already on Nexus · ⚠ mixed (uses Nexus + direct SDK) · ✗ bypasses Nexus.

| # | File | Status | Current direct calls | Recommended Nexus call | Notes / Risks |
|---|---|---|---|---|---|
| 1 | `lib/signal-engine.ts` | ✓ | — | — | Already migrated. Reference for pattern. |
| 2 | `lib/lead-factory-engine.ts` | ✓ | — | — | Already migrated. |
| 3 | `routes/meshbase.ts` | ✓ | — | — | Goes via `getOpenAIClient` wrapper. |
| 4 | `orcengine/ai-orchestrator.ts:5-7` | ⚠ | `new Anthropic({apiKey})` | `nexusSynthesize` for report writing; `nexusExtract` for field pulls | Used heavily for report drafting — `synthesize` tier is right fit. |
| 5 | `orcengine/agent-orchestra.ts` | ⚠ | direct Anthropic | `nexusGenerate({tier: "reasoning"})` | Multi-agent orchestration; verify no streaming. |
| 6 | `orcengine/enrichment.ts` | ⚠ | direct Anthropic | `nexusExtract` (field-level pulls are cheap) | Highest cost-savings candidate — moves frequent calls to DeepSeek. |
| 7 | `orcengine/prospecting-engine.ts:9` | ✗ | `import Anthropic from "@anthropic-ai/sdk"` | `nexusGenerate({tier: "reasoning"})` | — |
| 8 | `routes/company-intel.ts:4-8` | ⚠ | direct OpenAI + Anthropic | `nexusSynthesize` for 50-field profile; `nexusExtract` for parsing | Profile generation is the perfect synthesize use case. |
| 9 | `routes/person-intel.ts:4-8` | ⚠ | direct OpenAI + Anthropic | `nexusSynthesize` for dossier; `nexusExtract` for quick mode | `/person-intel/quick` → use `nexusRealtime`. |
| 10 | `routes/prosengine-chat.ts:2-8` | ⚠ | direct OpenAI + Anthropic; **streams SSE** | Blocked — Nexus has no streaming yet | **Do not migrate** until Nexus adds streaming. Document the gap. |
| 11 | `routes/sa-market.ts:6,10` | ✗ | `new OpenAI()` for AI-generated profile | `nexusSynthesize` | Endpoint: `POST /sa-market/profile/generate`. |
| 12 | `routes/masar-database.ts:23` | ✗ | direct Anthropic | `nexusExtract` for record parsing | — |
| 13 | `lib/masar-harvester.ts:18,76` | ✗ | direct Anthropic | `nexusExtract` | Harvest = high volume, cheap tier wins. |
| 14 | `lib/masaar-engine.ts:13` | ⚠ | direct Anthropic alongside Nexus | Drop the direct import, use existing `nexusGenerate` path | Quick win. |
| 15 | `lib/openai.ts` | – | Singleton OpenAI client | Keep singleton, but mark internal — engines should import Nexus | Used by `meshbase`, harvest scripts. Migrate callers, then delete. |
| 16 | `lib/anthropic-service.ts` | – | Singleton Anthropic with `enrichWithClaude` + `researchWithClaude` | Reimplement both functions on top of `nexusGenerate` / `nexusSynthesize` | Public API stays the same; internal swap. |

## Recommended migration order

1. **Phase 1 — leaf bypasses** (low risk, ~5 files):
   `lib/masar-harvester.ts`, `routes/masar-database.ts`, `routes/sa-market.ts`, `lib/masaar-engine.ts`, `orcengine/prospecting-engine.ts`.

2. **Phase 2 — mixed orcengine** (medium risk):
   `orcengine/ai-orchestrator.ts`, `orcengine/agent-orchestra.ts`, `orcengine/enrichment.ts`.

3. **Phase 3 — profile generators** (medium risk, output quality sensitive):
   `routes/company-intel.ts`, `routes/person-intel.ts`. Compare output before/after on 10 samples.

4. **Phase 4 — wrappers** (cleanup):
   Rewrite `lib/anthropic-service.ts` to delegate to Nexus, leave the exported function names unchanged. Mark `lib/openai.ts` as internal/deprecated.

5. **Phase 5 — streaming blocker** (requires Nexus enhancement):
   `routes/prosengine-chat.ts`. Add `nexusStream` to `lib/nexus/llm-router.ts`, then migrate.

## Per-call tier guide

| Use case | Function | Rationale |
|---|---|---|
| Pulling fields from raw HTML/text | `nexusExtract` | Cheap, DeepSeek-grade is enough |
| Saudi/Arabic-heavy generation | `nexusGenerate({ tier: "arabic" })` | Qwen 72B → Gemini |
| Multi-step reasoning, code | `nexusGenerate({ tier: "reasoning" })` | Claude/Gemini family |
| Final report, dossier, market analysis | `nexusSynthesize` | Frontier waterfall |
| Chat reply, autocomplete | `nexusRealtime` | Groq Llama |

## Acceptance checklist (per file migration)

- [ ] Remove `import OpenAI from "openai"` / `import Anthropic from "@anthropic-ai/sdk"`.
- [ ] Remove `new OpenAI(...)` / `new Anthropic(...)`.
- [ ] Replace each call with the right Nexus function + tier.
- [ ] Parse JSON output defensively (Nexus returns string).
- [ ] Confirm no streaming was used (if it was, file is blocked on Phase 5).
- [ ] Smoke-test the endpoint and compare output to the pre-migration baseline.
- [ ] Confirm cost appears in `GET /api/nexus/session/usage`.

## Out of scope

- Embeddings (Nexus does not yet route embedding calls).
- Vision (image input not yet supported by `nexusGenerate`).
- Audio/Whisper.

These call sites should keep direct SDK access until Nexus grows those layers.
