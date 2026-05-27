# Moonshot / Kimi

## Identity
Large-context, strong Arabic + multilingual. The planned **agent-swarm coordinator** and AI-Chat Plan-B planner. Base URL `https://api.moonshot.cn/v1` (OpenAI-compatible). Site: moonshot.cn / kimi.ai.
- Strength: huge context, excellent Arabic, cheap, good at decomposition/planning.
- Weakness: CN-hosted latency from Gulf; fewer JSON-mode guarantees than GPT-4o.

## Env vars
- Key: `MOONSHOT_API_KEY` or `KIMI_API_KEY` (either works).
- Model: `kimi-k2-0905-preview`.

## Role bindings
arabic (pin 2 — first non-free choice). **Planner (to be pinned)** for Swarm + Behavior Agent + AI-Chat Plan B.

## Reasoning mode
Strong decomposition / planning. Tool use: partial. Vision: no. Streaming: yes.

## Model shifting
- UP to Kimi → when task is `arabic` or `planner` and key present.
- DOWN from Kimi → if down, arabic tier → Orpheus-Arabic-Saudi (Groq) → Qwen.

## Fusion
Can be a fusion member for Arabic ensembles (Kimi + Qwen → Claude arbitrates).

## Costs (/1M tok)
≈ 0.15 / 2.50 (varies by context length).

## Routes that touch it
Indirect: arabic tier in `llm-router.ts`. Planned direct: `lib/agents/swarm.ts`, `routes/behavior.ts`, AI-Chat Plan B.

## Fallback chain
arabic: Kimi → Orpheus-Arabic-Saudi → Qwen-2.5-72b → Gemini → DeepSeek.

## Arabic
5/5 native. RTL OK. Code-switching excellent. Best choice for Saudi-dialect nuance alongside Orpheus.

## Notes
Agent-swarm coordinator role is the user's active build target — pin Kimi as planner when key present (plan §5/§7).
