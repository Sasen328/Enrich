import axios from "axios";
import { canSpend, recordSpend } from "./lib/paid-api-guard.js";

interface PerplexityMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface PerplexityResponse {
  choices: Array<{
    message: { content: string };
  }>;
  citations?: string[];
}

let _blocked = false;

export class PerplexityService {
  private baseUrl = "https://api.perplexity.ai/chat/completions";

  constructor() {
    if (!process.env.PERPLEXITY_API_KEY) {
      console.warn("[Perplexity] PERPLEXITY_API_KEY not set — Perplexity disabled.");
    }
    if (process.env.DISABLE_PERPLEXITY === "true") {
      console.warn("[Perplexity] DISABLE_PERPLEXITY=true — Perplexity disabled for this session.");
    }
  }

  private getKey(): string | null {
    if (_blocked) return null;
    if (process.env.DISABLE_PERPLEXITY === "true") return null;
    // Only spend Perplexity credit inside an explicitly-started job that is
    // still under its per-job budget. Outside a job (background ticks,
    // previews, speculative calls) this returns null and callers degrade.
    if (!canSpend("perplexity")) return null;
    return process.env.PERPLEXITY_API_KEY || null;
  }

  static isConfigured(): boolean {
    if (_blocked) return false;
    if (process.env.DISABLE_PERPLEXITY === "true") return false;
    if (!canSpend("perplexity")) return false;
    return !!process.env.PERPLEXITY_API_KEY;
  }

  private handleError(err: unknown): void {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      if (status === 401 || status === 403) {
        _blocked = true;
        console.warn(`[Perplexity] API key invalid (${status}) — disabling Perplexity for this session. Update or remove PERPLEXITY_API_KEY secret.`);
      }
    }
  }

  async search(query: string): Promise<string> {
    const key = this.getKey();
    if (!key) throw new Error("Perplexity is not configured or has been disabled");

    try {
      const response = await axios.post<PerplexityResponse>(
        this.baseUrl,
        {
          model: "sonar",
          messages: [
            { role: "system", content: "You are a helpful research assistant. Provide accurate, well-sourced information." },
            { role: "user", content: query },
          ],
          max_tokens: 4000,
        },
        {
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          timeout: 60000,
        },
      );
      recordSpend("perplexity");
      return response.data.choices[0]?.message?.content || "";
    } catch (err) {
      this.handleError(err);
      throw err;
    }
  }

  async researchQuery(query: string): Promise<{ answer: string; citations?: string[] }> {
    const key = this.getKey();
    if (!key) throw new Error("Perplexity is not configured or has been disabled");

    try {
      const response = await axios.post<PerplexityResponse>(
        this.baseUrl,
        {
          model: "sonar",
          messages: [
            { role: "system", content: "You are a Saudi Arabian business intelligence researcher. Provide accurate, well-sourced information with citations." },
            { role: "user", content: query },
          ],
          max_tokens: 1500,
          return_citations: true,
        },
        {
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          timeout: 60000,
        },
      );
      recordSpend("perplexity");
      return {
        answer: response.data.choices[0]?.message?.content || "",
        citations: response.data.citations,
      };
    } catch (err) {
      this.handleError(err);
      throw err;
    }
  }

  async chat(messages: PerplexityMessage[]): Promise<string> {
    const key = this.getKey();
    if (!key) throw new Error("Perplexity is not configured or has been disabled");

    try {
      const response = await axios.post<PerplexityResponse>(
        this.baseUrl,
        {
          model: "sonar",
          messages,
          max_tokens: 4000,
        },
        {
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          timeout: 60000,
        },
      );
      recordSpend("perplexity");
      return response.data.choices[0]?.message?.content || "";
    } catch (err) {
      this.handleError(err);
      throw err;
    }
  }
}

export const perplexity = new PerplexityService();
export const perplexityService = perplexity;
