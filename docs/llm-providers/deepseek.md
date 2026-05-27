# DeepSeek

## Identity
Cheapest capable extractor + bulk workhorse; DeepSeek-R1 gives native reasoning. Base URL `https://api.deepseek.com/v1` (OpenAI-compatible). Native adapter is cheaper than the OpenRouter proxy.
- Strength: rock-bottom price, strong JSON extraction, R1 reasoning.
- Weakness: slower first token; CN-hosted.

## Env vars
- Key: `DEEPSEEK_API_KEY`. Models: `deepseek-chat` (v3), `deepseek-r1` (reasoning).

## Role bindings
extraction (pin 3, before OpenRouter proxy) · bulk (pin 3) · synthesis via R1 when reasoning requested.

## Reasoning mode
R1 = native CoT. chat = no. Tool use: limited. Vision: no. Streaming: yes.

## Model shifting
- DOWN to DeepSeek → default for extraction/bulk to minimise cost.
- UP from DeepSeek → synthesis escalates to Claude/Gemini.

## Fusion
Primary fusion member (DeepSeek-v3 + Llama-3.3 is the default ensemble pair).

## Costs (/1M tok)
deepseek-chat 0.27/0.27 · deepseek-r1 0.55/2.19. `:free` via OpenRouter when PREFER_FREE.

## Routes
Indirect: extraction + bulk tiers. Direct: none (always via Nexus).

## Fallback chain
extraction: DeepSeek → OpenRouter DeepSeek → Groq Llama → Qwen → Gemini → GPT-4o-mini.

## Arabic
3/5. Fine for extraction; prefer Kimi/Qwen for Arabic synthesis.

## Notes
Native key preferred over OpenRouter proxy (cheaper, fewer hops).
