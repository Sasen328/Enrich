# Groq

## Identity
Speed king — 800 tok/s on Llama; free tier; hosts Orpheus-Arabic-Saudi. Base URL `https://api.groq.com/openai/v1`.
- Strength: sub-second responses, free, dedicated Saudi Arabic model.
- Weakness: limited model catalogue; rate caps on free tier.

## Env vars
- Key: `GROQ_API_KEY`. Models: `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`, `canopylabs/orpheus-arabic-saudi`.

## Role bindings
realtime (pin 3) · extraction (pin 5) · arabic (pin 3, Orpheus) · bulk (pin 5, 8b-instant).

## Reasoning mode
No CoT. Tool use: partial. Vision: no. Streaming: yes (very fast).

## Model shifting
- DOWN/realtime → Groq when speed-critical (< 2 s SLA).
- UP from Groq → synthesis when depth needed.

## Costs (/1M tok)
Llama free tier 0/0 (capped); Orpheus-Arabic-Saudi 0/0.

## Routes
Indirect: realtime + arabic + extraction + bulk tiers.

## Fallback chain
realtime: Groq → OpenRouter DeepSeek → Gemini.

## Arabic
Orpheus-Arabic-Saudi = 5/5 Saudi dialect. RTL OK.

## Notes
Best realtime SSE token streaming. Use 8b-instant for cheap bulk classification.
