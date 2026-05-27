# OpenRouter

## Identity
Unified gateway to 100+ models (DeepSeek, Llama, Qwen, Mistral, Claude-via-OR, Gemini-via-OR). Primary aggregator + the only path for **fusion**. Site: openrouter.ai.
- Strength: one key → every open-weight model; `:free` variants; cheapest extraction.
- Weakness: proxy adds ~100-300 ms; rate caps on free tier.

## Env vars
- Required: `OPENROUTER_API_KEY`
- Optional: `NEXUS_PREFER_FREE_MODELS=true` (prepend `:free` models to every chain)

## Role bindings
extraction (pin 4) · arabic (pin 4) · realtime (pin 4) · bulk (pin 4) · synthesis (pin 5). Also the fusion host.

## Reasoning mode
Yes — routes to `deepseek/deepseek-r1` for CoT. Tool use + JSON mode depend on the underlying model. Streaming: yes.

## Model shifting
- UP from here → native Anthropic/OpenAI when synthesis quality matters.
- DOWN to here → when native keys absent but OpenRouter present (universal fallback).

## Fusion behaviour
Hosts `nexusFusion()`. Ensembles e.g. `deepseek-v3` + `llama-3.3-70b` in parallel; Claude arbitrates conflicts; else first-valid-JSON. Latency budget default 8 s.

## Costs (May 2026, /1M tok)
deepseek-chat 0.27/0.27 · deepseek-r1 0.55/2.19 · llama-3.3-70b 0.10/0.12 · qwen-2.5-72b 0.40/0.40 · `:free` variants 0/0.

## Routes that touch it
Indirect via Nexus (every tier). Direct: none.

## Fallback chain
On 4xx/5xx/timeout → next entry in the active tier chain (Groq / Gemini / native DeepSeek).

## Arabic
Via Qwen-2.5-72b — rating 4/5, RTL OK, code-switching OK.

## Notes
Free tier has daily caps; production should set a paid OpenRouter balance. `HTTP-Referer` + `X-Title` headers set for analytics.
