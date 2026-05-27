# Google Gemini

## Identity
Multimodal + Google-Search grounding. `gemini-search.ts` wraps `generateWithGemini()`.
- Strength: Google Search grounding, multimodal, generous free tier, fast flash model.
- Weakness: occasional safety-filter false positives.

## Env vars
- Key: `GEMINI_API_KEY`. Model: `gemini-2.5-flash`.

## Role bindings
extraction (pin 7) · arabic (pin 5) · realtime (pin 5) · synthesis (pin 2, before Claude).

## Reasoning mode
Flash = fast, light reasoning. Tool use: Google Search grounding. Vision: yes. Streaming: yes.

## Model shifting
- synthesis tries Gemini before Claude (cost). UP to Claude if Gemini empty/filtered.

## Costs (/1M tok)
gemini-2.5-flash ≈ 0.075 / 0.30.

## Routes
Direct: `company-intel.ts` (×5), `person-intel.ts` (×2), `meshbase.ts` enrichment, `gemini-search.ts`. Indirect: most tiers.

## Fallback chain
synthesis: Gemini → Claude → OpenAI → OpenRouter DeepSeek.

## Arabic
4/5; good multilingual. RTL OK.

## Notes
`isGeminiConfigured()` guard everywhere — skips cleanly when key unset.
