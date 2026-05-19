import OpenAI from "openai";
import { env } from "./config/env.js";

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (_client) return _client;
  if (!env.openaiKey) {
    throw new Error("No OpenAI API key configured. Set OPENAI_API_KEY (see docs/ENV.md).");
  }
  _client = new OpenAI({ apiKey: env.openaiKey });
  return _client;
}

export const openai = new Proxy({} as OpenAI, {
  get(_t, prop) {
    const c = getClient() as unknown as Record<string | symbol, unknown>;
    const v = c[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(c) : v;
  },
});
