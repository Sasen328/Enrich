# OpenAI (GPT-4o)

## Identity
Structured extraction + Arabic report generation + Data-Seeder EVAL vision. `openai-client.ts`.
- Strength: best JSON-mode/function-calling reliability, vision (OCR for Data Seeder), strong AR report.
- Weakness: pricey vs DeepSeek; not first choice for cost-sensitive bulk.

## Env vars
- Key: `OPENAI_API_KEY`. Models: `gpt-4o`, `gpt-4o-mini`, `gpt-4o` vision.

## Role bindings
extraction (pin 8, gpt-4o-mini) · synthesis (pin 4) · Data-Seeder EVAL vision (direct) · Masaar Agent 5 AR.

## Reasoning mode
Solid. Tool use: yes (best function calling). Vision: yes (Data Seeder OCR + page-map). JSON mode: yes. Streaming: yes.

## Model shifting
- Data Seeder EVAL phase pins GPT-4o-vision for OCR/structural mapping.
- Otherwise mid-priority fallback in extraction + synthesis.

## Costs (/1M tok)
gpt-4o ≈ 2.5 / 10 · gpt-4o-mini ≈ 0.15 / 0.60.

## Routes
Direct: `prosengine-chat.ts` (seeder), `masaar-engine.ts` (Agent 5 AR), `company-intel.ts`, `person-intel.ts`. Indirect: extraction + synthesis.

## Fallback chain
extraction: …→ gpt-4o-mini (last). synthesis: …→ gpt-4o (after Claude).

## Arabic
4/5; strong AR report writing (Masaar uses it for Arabic synthesis).

## Notes
Reserve gpt-4o-vision for the Data Seeder EVAL pre-flight (plan §4A) — it's the OCR/structural-map brain.
