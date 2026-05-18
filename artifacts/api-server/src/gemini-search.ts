import { GoogleGenAI } from "@google/genai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

export function isGeminiConfigured(): boolean {
  return !!GEMINI_API_KEY;
}

function getClient(): GoogleGenAI {
  return new GoogleGenAI({ apiKey: GEMINI_API_KEY });
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export async function generateWithGemini(
  prompt: string,
  systemPrompt?: string,
  model: "gemini-2.5-flash" | "gemini-2.5-pro" = "gemini-2.5-flash"
): Promise<string | null> {
  if (!isGeminiConfigured()) return null;
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const ai = getClient();
      const contents = systemPrompt
        ? [
            { role: "user" as const, parts: [{ text: systemPrompt }] },
            { role: "model" as const, parts: [{ text: "Understood. I will follow those instructions precisely." }] },
            { role: "user" as const, parts: [{ text: prompt }] },
          ]
        : [{ role: "user" as const, parts: [{ text: prompt }] }];

      const response = await withTimeout(
        ai.models.generateContent({ model, contents, config: { maxOutputTokens: 8192, temperature: 0.3 } }),
        55000,
        null as any
      );
      if (!response) { console.warn(`[Gemini] generateWithGemini timeout (${model})`); return null; }
      return response.text ?? null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const is503 = msg.includes("503") || msg.includes("UNAVAILABLE") || msg.includes("high demand") || msg.includes("overloaded");
      if (is503 && attempt < MAX_RETRIES - 1) {
        const delay = (attempt + 1) * 2000;
        console.warn(`[Gemini] 503 on ${model} (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      console.warn(`[Gemini] generateWithGemini error (${model}):`, msg);
      return null;
    }
  }
  return null;
}

// searchWithGemini — Chrome AI mode: Google Search grounding + URL Context (browses pages like a browser)
// All callers across the codebase get real-time web search automatically.
export async function searchWithGemini(query: string): Promise<string | null> {
  if (!isGeminiConfigured()) return null;
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const ai = getClient();
      const response = await withTimeout(
        ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [
            {
              role: "user",
              parts: [{ text: "You are a Saudi Arabia B2B intelligence researcher. Answer in detailed English. Provide factual, current information from live web sources." }],
            },
            { role: "model", parts: [{ text: "Understood. I will search the web and browse pages to provide accurate, current information." }] },
            { role: "user", parts: [{ text: query }] },
          ],
          config: {
            tools: [{ googleSearch: {} }, { urlContext: {} }],
            temperature: 0.2,
            maxOutputTokens: 4096,
          },
        }),
        55000,
        null as any
      );
      if (!response) {
        console.warn("[Gemini] searchWithGemini timeout");
        return null;
      }
      return response.text ?? null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const is503 = msg.includes("503") || msg.includes("UNAVAILABLE") || msg.includes("high demand") || msg.includes("overloaded");
      if (is503 && attempt < MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, (attempt + 1) * 2000));
        continue;
      }
      console.warn("[Gemini] searchWithGemini error:", msg.substring(0, 120));
      return null;
    }
  }
  return null;
}

export async function searchMultipleWithGemini(queries: string[], systemContext?: string): Promise<string | null> {
  if (!isGeminiConfigured()) return null;
  try {
    const results = await Promise.all(
      queries.slice(0, 3).map(q => deepResearchTextWithGemini(q, systemContext, "gemini-2.5-flash"))
    );
    const combined = results.filter(Boolean).join("\n\n---\n\n");
    return combined || null;
  } catch {
    return null;
  }
}

export async function researchCompanyWithGemini(name: string): Promise<Record<string, unknown> | null> {
  if (!isGeminiConfigured()) return null;
  const prompt = `Research the Saudi Arabia company "${name}". Return ONLY valid JSON with these fields: name, nameAr, industry, description, headquarters, city, website, employeeCount, revenue, foundedYear, crNumber, legalForm, keyExecutives (array of {name, title}), shareholders (array of {name, percentage}), marketPositioning, recentNews. Use null for unknown fields.`;
  try {
    const result = await generateWithGemini(prompt, "You are a Saudi Arabia B2B intelligence analyst. Return ONLY valid JSON, no markdown.", "gemini-2.5-pro");
    if (!result) return null;
    const match = result.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function synthesizeWithGemini(
  prompt: string,
  systemPrompt = "You are an elite Saudi Arabia B2B intelligence analyst. Return valid JSON only. Be maximally specific and actionable.",
  model: "gemini-2.5-flash" | "gemini-2.5-pro" = "gemini-2.5-pro"
): Promise<string | null> {
  return generateWithGemini(prompt, systemPrompt, model);
}

export async function deepResearchWithGemini(
  query: string,
  systemContext = "You are a Saudi Arabia B2B intelligence analyst. Use Google Search to find real, current, accurate information.",
  model: "gemini-2.5-flash" | "gemini-2.5-pro" = "gemini-2.5-pro",
  useUrlContext = true
): Promise<{ text: string; groundingChunks: string[] } | null> {
  if (!isGeminiConfigured()) return null;
  const MAX_RETRIES = 3;
  const tools = useUrlContext
    ? [{ googleSearch: {} }, { urlContext: {} }]
    : [{ googleSearch: {} }];
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const ai = getClient();
      const response = await withTimeout(
        ai.models.generateContent({
          model,
          contents: [
            { role: "user", parts: [{ text: systemContext }] },
            { role: "model", parts: [{ text: "Understood. I will search the web, browse pages, and provide accurate, current information." }] },
            { role: "user", parts: [{ text: query }] },
          ],
          config: { tools, temperature: 0.2, maxOutputTokens: 8192 },
        }),
        55000,
        null as any
      );
      if (!response) { console.warn(`[Gemini] deepResearchWithGemini timeout (${model})`); return null; }

      const text = response.text ?? "";
      const chunks: string[] = [];
      const candidates = (response as any).candidates ?? [];
      for (const candidate of candidates) {
        const groundingMetadata = candidate.groundingMetadata;
        if (groundingMetadata?.groundingChunks) {
          for (const chunk of groundingMetadata.groundingChunks) {
            if (chunk.web?.uri) chunks.push(chunk.web.uri);
          }
        }
      }
      return { text, groundingChunks: chunks };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const is503 = msg.includes("503") || msg.includes("UNAVAILABLE") || msg.includes("high demand") || msg.includes("overloaded");
      if (is503 && attempt < MAX_RETRIES - 1) {
        const delay = (attempt + 1) * 2000;
        console.warn(`[Gemini] 503 on deepResearch/${model} (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      console.warn(`[Gemini] deepResearchWithGemini error (${model}):`, msg.substring(0, 120));
      return null;
    }
  }
  return null;
}

export async function deepResearchTextWithGemini(
  query: string,
  systemContext?: string,
  model: "gemini-2.5-flash" | "gemini-2.5-pro" = "gemini-2.5-pro"
): Promise<string | null> {
  const result = await deepResearchWithGemini(query, systemContext, model);
  return result?.text ?? null;
}

export async function extractCompaniesWithGemini(
  pageText: string,
  keyword: string
): Promise<Array<{ nameEn?: string; nameAr?: string; city?: string; phone?: string; mainActivity?: string; website?: string; crNumber?: string; foundingYear?: string; legalForm?: string }>> {
  if (!isGeminiConfigured()) return [];
  const prompt = `Extract all Saudi Arabia company/business entities from the text below that are related to "${keyword}".

TEXT:
${pageText.slice(0, 10000)}

Return ONLY a JSON array of objects with fields (use null for unknown):
[{"nameEn":"English name","nameAr":"Arabic name","city":"city","phone":"phone","mainActivity":"activity description","website":"url","crNumber":"CR number","foundingYear":"year","legalForm":"LLC/JSC/etc"}]

Rules:
- Only include genuine business entities (not people, locations, or generic terms)
- Include both Arabic and English names when available
- Return empty array [] if nothing found`;

  try {
    const result = await generateWithGemini(prompt, "You are a Saudi Arabia business data extraction expert. Return ONLY a JSON array, no markdown, no explanation.", "gemini-2.5-flash");
    if (!result) return [];
    const match = result.match(/\[[\s\S]*\]/);
    if (!match) return [];
    return JSON.parse(match[0]) as Array<Record<string, string>>;
  } catch {
    return [];
  }
}
