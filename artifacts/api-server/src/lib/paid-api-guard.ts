// Paid-API guard — stops Perplexity / Apollo / Explorium / etc. from being
// called unless we're inside an explicitly-started job, and caps how many
// calls a single job may make.
//
// Why: a single "Enrich All" or auto-downstream fan-out was firing hundreds
// of Perplexity searches server-side with no further user action, burning
// real credit. This guard makes paid calls require a job context + budget.
//
// Usage at a job entrypoint:
//   import { runInJob } from "../lib/paid-api-guard.js";
//   runInJob("lead-factory:123", () => runLeadFactoryPipeline(...));
//
// Usage at a paid-API client:
//   import { canSpend, recordSpend } from "../lib/paid-api-guard.js";
//   if (!canSpend("perplexity")) return null;   // no job / over budget → skip
//   ...make the call...
//   recordSpend("perplexity");

import { AsyncLocalStorage } from "node:async_hooks";

export type PaidApi = "perplexity" | "apollo" | "explorium" | "openai" | "anthropic" | "gemini" | "scout";

interface JobCtx {
  jobId: string;
  budgets: Record<string, number>;
  spent: Record<string, number>;
}

const als = new AsyncLocalStorage<JobCtx>();

// Master switch. When true (default), paid APIs require an active job context.
// Set PAID_API_REQUIRE_JOB=false to restore the old always-on behaviour.
function requireJob(): boolean {
  return process.env.PAID_API_REQUIRE_JOB !== "false";
}

// Per-job default budgets (override via env). Conservative defaults so a
// single runaway job can't drain credit.
function defaultBudgets(): Record<string, number> {
  return {
    perplexity: Number(process.env.PERPLEXITY_JOB_BUDGET ?? 25),
    apollo:     Number(process.env.APOLLO_JOB_BUDGET ?? 10),
    explorium:  Number(process.env.EXPLORIUM_JOB_BUDGET ?? 10),
  };
}

/** Wrap a real, user-initiated job so paid APIs are permitted within it. */
export function runInJob<T>(jobId: string, fn: () => T, budgetOverrides: Record<string, number> = {}): T {
  const ctx: JobCtx = {
    jobId,
    budgets: { ...defaultBudgets(), ...budgetOverrides },
    spent: {},
  };
  return als.run(ctx, fn);
}

/** True only if inside an active job AND under that API's budget. */
export function canSpend(api: PaidApi): boolean {
  if (!requireJob()) return true; // guard disabled → behave as before
  const ctx = als.getStore();
  if (!ctx) return false;          // no active job → block paid call
  const budget = ctx.budgets[api] ?? Infinity;
  return (ctx.spent[api] ?? 0) < budget;
}

/** Record one paid call against the current job budget. */
export function recordSpend(api: PaidApi, n = 1): void {
  const ctx = als.getStore();
  if (ctx) ctx.spent[api] = (ctx.spent[api] ?? 0) + n;
}

/**
 * Enter a job context for the remainder of the current async execution
 * (e.g. an Express request handler) without wrapping a callback. Use at the
 * top of a single user-initiated handler where re-indenting the whole body
 * would be noisy.
 */
export function enterJob(jobId: string, budgetOverrides: Record<string, number> = {}): void {
  als.enterWith({
    jobId,
    budgets: { ...defaultBudgets(), ...budgetOverrides },
    spent: {},
  });
}

/** Current job id, or null if outside a job. */
export function activeJobId(): string | null {
  return als.getStore()?.jobId ?? null;
}

/** Snapshot of spend for logging / SSE. */
export function spendSnapshot(): { jobId: string; spent: Record<string, number>; budgets: Record<string, number> } | null {
  const ctx = als.getStore();
  return ctx ? { jobId: ctx.jobId, spent: { ...ctx.spent }, budgets: { ...ctx.budgets } } : null;
}
