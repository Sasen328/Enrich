# Ollama (local)

## Identity
Zero-cost local inference — last-resort bulk fallback when no cloud key works or for privacy-sensitive bulk.
- Strength: free, private, offline.
- Weakness: quality + speed depend on host hardware; not for synthesis.

## Env vars
- `OLLAMA_BASE_URL` (e.g. `http://localhost:11434`), `OLLAMA_MODEL` (default `llama3.1`).

## Role bindings
bulk (pin 2 — right after free OpenRouter). Never synthesis.

## Reasoning mode
Model-dependent. Tool use: no. Vision: no. Streaming: yes.

## Costs
0 (self-hosted compute only).

## Routes
Indirect: bulk tier only.

## Fallback chain
bulk: free OpenRouter → Ollama → DeepSeek native → OpenRouter v3-5 → Groq 8b.

## Arabic
Depends on local model (Qwen/Aya recommended for Arabic).

## Notes
Only attempted if `OLLAMA_BASE_URL` reachable; otherwise skipped silently. Good for high-volume classification on a beefy VPS.
