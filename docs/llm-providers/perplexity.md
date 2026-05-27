# Perplexity

## Identity
Live-web reasoning — every answer is grounded in fresh search with citations. Base URL `https://api.perplexity.ai` (`perplexity-service.ts`).
- Strength: realtime facts + source URLs; best for "what happened recently".
- Weakness: not for offline reasoning; per-call cost.

## Env vars
- Key: `PERPLEXITY_API_KEY`. Model: `llama-3.1-sonar-large-128k-online`.

## Role bindings
realtime (pin 2 — first real web source) · researcher role.

## Reasoning mode
Web-grounded reasoning. Tool use: no. Vision: no. Streaming: yes.

## Model shifting
- realtime escalates to Perplexity for live data; falls to Groq/Gemini if down.

## Costs (/1M tok)
sonar-large ≈ 1 / 1 + per-search fee.

## Routes
Direct: `company-intel.ts` (×4), `person-intel.ts` (×4), `masaar-engine.ts` Agent 3 (×5), `signals.ts`. Indirect: realtime tier.

## Fallback chain
realtime: Perplexity → Groq → OpenRouter DeepSeek → Gemini. Returns null gracefully when down — callers continue with other sources.

## Arabic
3/5; English-primary. Pair with Kimi for Arabic synthesis.

## Notes
Heavy user in ProsEngine + Masaar deep research. Each query counts — bulk-batch where possible.
