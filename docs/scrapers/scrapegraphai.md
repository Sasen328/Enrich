# ScrapeGraphAI (planned — Layer 4)

## Role
Natural-language extraction. Describe what you want ("company name, founders, contact emails") and the LLM maps the DOM graph → JSON. Eliminates brittle CSS selectors.

## When it fires
L1-L3 fetched HTML but structured extraction is ambiguous / selector-free → hand the page to ScrapeGraphAI with a schema prompt.

## File
`lib/scrapers/scrapegraph-client.ts` — calls into the Scout microservice (Python) which runs ScrapeGraphAI with the Nexus extraction tier as its LLM backend.

## LLM backend
Routes through Nexus `extraction` tier (DeepSeek/Llama/Qwen) — NOT a separate key. Keeps cost low.

## Env
Runs inside Scout container; `SCOUT_URL` reachable.

## Notes
Powers the Data Seeder HARVEST phase (plan §4A) — schema comes from the GPT-4o EVAL pre-flight.
