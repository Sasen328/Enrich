import OpenAI from "openai";

// Prefer direct real key (works in both dev and prod).
const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  console.warn("No OpenAI API key configured. OrcEngine AI features will be unavailable.");
}

export const openai = new OpenAI({
  apiKey: apiKey || "missing-key-will-fail-at-runtime",
});

export function getOpenAIClient(): OpenAI {
  if (!apiKey) {
    throw new Error("OpenAI is not configured. Set OPENAI_API_KEY.");
  }
  return openai;
}
