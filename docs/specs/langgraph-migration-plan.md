# LangGraph Migration Plan — Lead Factory

**Status:** plan for review. No migration started.

## TL;DR

The current `lib/lead-factory-engine.ts` is a 2,078-line hand-rolled 7-agent pipeline. LangGraph would give us a declarative graph definition, built-in checkpointing (resumable jobs), branch/loop primitives, and better observability. The migration is **~2 weeks** of focused work and a real architectural change (introduces Python service or LangGraph.js dependency).

## Why migrate

| Pain today | LangGraph fix |
|---|---|
| Linear stages: hard to add conditional branches ("if signals score < 30, skip outreach") | Native conditional edges |
| Cancellation is cooperative but agents don't poll | Checkpoint between nodes → cancel writes "cancelled" to checkpoint, next node sees it |
| Crash = lost work. Pipeline restarts from agent 1 | `MemorySaver` / `PostgresSaver` → resume from last checkpoint |
| SSE emission scattered through agent functions | Graph events map 1:1 to a single emitter |
| No way to "run Agent 3 only" for one prospect | LangGraph subgraphs |
| Adding a new agent = thread it through 5 spots | Declarative add a node + an edge |

## Why NOT migrate (yet)

- The current engine **works**. It's been hardened with `JobRegistry`, cancellation, SSE, retry, dedup.
- LangGraph.js is **less mature** than LangGraph (Python). Many features land in Python first.
- A Python LangGraph service means **a third runtime** (you already have Node + Python Scout) — adds deployment surface.
- Cost: ~2 weeks of senior dev time. Pays back only if you're adding new agents / dynamic branching imminently.

**Read this before deciding:** the migration is a quality-of-life upgrade, not a feature unlock. Every Lead Factory feature you can build with LangGraph, you can build with the current engine — it'll just be uglier.

## Decision: language choice

| Option | Pros | Cons |
|---|---|---|
| **LangGraph.js** | Same runtime as the API server. No new microservice. | Smaller ecosystem; checkpointers less battle-tested; fewer examples. |
| **LangGraph (Python)** | Mature; most tutorials use it; richer checkpointer options. | Forces a new FastAPI service. Adds gRPC/HTTP boundary between Express and the pipeline. Doubles the deployment footprint. |

**Recommendation:** LangGraph.js. The maturity gap is closing and we keep one runtime.

## Target graph

```
                                ┌───────────┐
                          ┌────▶│  Agent 1  │── icp + sourcing plan
                          │     │ icpMapper │
   ┌─────────┐   start    │     └─────┬─────┘
   │ Brief   │────────────┘           ▼
   │ (Zod)   │                  ┌───────────┐
   └─────────┘                  │  Agent 2  │── raw leads (40+ free + paid)
                                │ harvester │
                                └─────┬─────┘
                                      ▼
                                ┌───────────┐
                                │  Agent 3  │── enriched leads
                                │ enriched  │
                                └─────┬─────┘
                                      ▼
                                ┌───────────┐    if no signals:
                                │  Agent 4  │────────────┐
                                │  signals  │            │
                                └─────┬─────┘            │
                                      ▼                  ▼
                                ┌───────────┐    ┌──────────┐
                                │  Agent 5  │───▶│  reject  │
                                │ validate  │    │  output  │
                                └─────┬─────┘    └──────────┘
                                      ▼
                                ┌───────────┐
                                │  Agent 6  │── scored + outreach
                                │  scoring  │
                                └─────┬─────┘
                                      ▼
                                ┌───────────┐
                                │  Agent 7  │── publish + bridge
                                │  publish  │── + auto-enrich downstream
                                └───────────┘
```

Conditional edges (the win):

- `Agent 4 → Agent 5` if `signalsScore >= signalsThreshold` else `→ end (rejected)`.
- `Agent 5 → Agent 6` if `validationPassed` else `→ end`.
- `Agent 7 → optional fan-out`: for each new company, **subgraph** runs Signals scan + Relationship Intel (replaces the current `autoEnrichDownstream` logic).

## Phased plan

### Phase 0 — Spike (3 days)
- New `lib/lead-factory-graph/` directory.
- Migrate Agent 1 only into a LangGraph node.
- Wire alongside current pipeline behind `LEAD_FACTORY_USE_LANGGRAPH=true` env toggle.
- Same I/O contract (Zod brief in, agentProgress JSON out).
- **Gate:** does it pass the same job through both pipelines and produce equivalent output?

### Phase 1 — Lift the rest (1 week)
- Migrate Agents 2–7 one by one. Each commit = one node + its tests.
- Keep the old engine as the default.
- Add `PostgresSaver` checkpointing (drizzle-backed table `lead_factory_checkpoints`).
- Add `/api/lead-factory/jobs/:jobId/resume` endpoint that picks up from the last checkpoint after a crash.

### Phase 2 — Cut over (3 days)
- Flip `LEAD_FACTORY_USE_LANGGRAPH=true` by default.
- Remove old `runLeadFactoryPipeline` after 1 week of clean prod runs.
- Delete `~1,800 LOC` from `lead-factory-engine.ts` (only the node bodies remain, ~600 LOC total).

### Phase 3 — Win the benefits (ongoing)
- Add conditional edges (`if signalScore < threshold → reject`).
- Add subgraph for downstream auto-enrich.
- Add a dynamic "Agent 8: re-discover" loop that re-queries free sources when Agent 5 rejects > 50% of leads.

## New deps

```json
{
  "@langchain/langgraph": "^0.2.x",
  "@langchain/core": "^0.3.x"
}
```

(Already-installed `@anthropic-ai/sdk` / `openai` are sufficient for the LLM bindings.)

## Risks

1. **LangGraph.js API churn.** It's pre-1.0; minor versions occasionally break.
2. **Streaming.** Current SSE emission is per-agent; need to confirm LangGraph.js streams hook into Express SSE cleanly. (It does, via `graph.streamEvents()`.)
3. **Cancellation.** LangGraph supports `RunnableConfig.signal` (AbortSignal); maps to our existing `JobRegistry.getSignal(jobId)`.
4. **Cost.** Each agent's prompt is unchanged, so per-job LLM cost is the same.

## Decision needed

Before phase 0, you need to decide:
- Confirm LangGraph.js (not Python).
- Confirm the migration is worth the 2-week opportunity cost vs. shipping the UI redesign first.

If both yes → I open a tracking issue and start Phase 0 spike on a separate branch.
