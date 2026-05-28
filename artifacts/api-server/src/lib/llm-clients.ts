// §12 — Lazy, guarded LLM clients.
//
// Replaces the `new Anthropic({ apiKey: process.env.X || "dummy" })` anti-pattern
// (which boots fine but then 401s with a confusing message when the key is
// missing) with clients that construct on first use and throw a clean,
// 503-mapped MissingEnvError naming the exact env var. Construction is deferred
// so a missing key never blocks server boot — only the feature that needs it.
//
// Call sites are unchanged: a lazy client behaves like the real SDK client
// (e.g. `anthropic.messages.create(...)`, `openai.chat.completions.create(...)`).

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { requireEnv } from "./require-env.js";

function lazy<T extends object>(make: () => T): T {
  let instance: T | null = null;
  const target = (): T => (instance ??= make());
  return new Proxy({} as T, {
    get(_t, prop) {
      const real = target() as Record<string | symbol, unknown>;
      const value = real[prop];
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(real) : value;
    },
    has(_t, prop) {
      return prop in (target() as object);
    },
  });
}

/** Anthropic client that 503s (naming ANTHROPIC_API_KEY) on first use if unset. */
export function lazyAnthropic(feature: string): Anthropic {
  return lazy(() => new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY", feature) }));
}

/** OpenAI client that 503s (naming OPENAI_API_KEY) on first use if unset. */
export function lazyOpenAI(feature: string): OpenAI {
  return lazy(() => new OpenAI({ apiKey: requireEnv("OPENAI_API_KEY", feature) }));
}
