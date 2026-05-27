# Anthropic (Claude)

## Identity
Frontier reasoning + the AI Chat orchestrator brain. Site: anthropic.com.
- Strength: long-context tool-use loops, complex instruction following, report synthesis, vision (CAPTCHA solving).
- Weakness: priciest synthesis option; hard-required for the AI Chat tool loop today.

## Env vars
- Required for: AI Chat orchestrator, Masaar CAPTCHA vision, Masaar Agent 5 EN report.
- Key: `ANTHROPIC_API_KEY` · model override `AI_CHAT_ORCHESTRATOR_MODEL` (default `claude-sonnet-4-6`).

## Role bindings
synthesis (pin 3 — after free DeepSeek-R1 + Gemini). Orchestrator default. Fusion arbitrator.

## Reasoning mode
Extended thinking: yes. Tool use: yes (drives the 9-tool loop). Vision: yes. JSON/function calling: yes. Streaming: yes.

## Model shifting
- UP to Claude → when synthesis quality matters or fusion arbitration needed.
- DOWN from Claude → `X-Nexus-Tier: bulk` or budget mode routes to DeepSeek/Llama instead.

## Costs (/1M tok)
claude-sonnet-4-5/4-6 ≈ 3 / 15.

## Routes that touch it
Direct: `routes/ai-chat.ts`, `lib/agents/orchestrator.ts`, `lib/masaar-engine.ts` (Agent 1b vision + Agent 5), `company-intel.ts`, `person-intel.ts`. Indirect: synthesis tier.

## Fallback chain
If absent/invalid → synthesis tier falls to Gemini → OpenAI → OpenRouter DeepSeek. **AI Chat Plan B** (planned): delegate to Kimi planner.

## Arabic
4/5 via prompt; not native-Saudi. Prefer Kimi/Orpheus for heavy Arabic.

## Notes
Today ~17 routes use `ANTHROPIC_API_KEY || "dummy"` → 401 instead of graceful 503. Fix tracked in deploy-hardening (§12 of plan).
