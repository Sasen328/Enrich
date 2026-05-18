import OpenAI from "openai";
import { env } from "./config/env.js";

if (!env.openaiKey) {
  throw new Error("No OpenAI API key configured. Set OPENAI_API_KEY (see docs/ENV.md).");
}

export const openai = new OpenAI({ apiKey: env.openaiKey });
