import axios from "axios";

const HF_BASE = "https://api-inference.huggingface.co/models";

export function isHuggingFaceConfigured(): boolean {
  return !!process.env.HUGGING_FACE_API_KEY;
}

function getHeaders() {
  return {
    Authorization: `Bearer ${process.env.HUGGING_FACE_API_KEY}`,
    "Content-Type": "application/json",
  };
}

export async function extractEntitiesFromText(
  text: string
): Promise<Array<{ entity: string; word: string; score: number }>> {
  if (!isHuggingFaceConfigured()) return [];

  try {
    const res = await axios.post<Array<{ entity_group?: string; entity?: string; word: string; score: number }>>(
      `${HF_BASE}/dslim/bert-base-NER`,
      { inputs: text.slice(0, 512) },
      { headers: getHeaders(), timeout: 15000 }
    );

    return (res.data || [])
      .filter((e) => e.score > 0.8)
      .map((e) => ({
        entity: e.entity_group || e.entity || "MISC",
        word: e.word,
        score: e.score,
      }));
  } catch {
    return [];
  }
}

export async function classifyIndustry(text: string): Promise<string | null> {
  if (!isHuggingFaceConfigured()) return null;

  const labels = [
    "Oil and Gas",
    "Banking and Finance",
    "Construction",
    "Healthcare",
    "Technology",
    "Telecommunications",
    "Retail",
    "Food and Beverage",
    "Real Estate",
    "Manufacturing",
    "Transportation and Logistics",
    "Education",
    "Tourism and Hospitality",
    "Energy",
    "Mining",
    "Petrochemicals",
  ];

  try {
    const res = await axios.post<{ labels: string[]; scores: number[] }>(
      `${HF_BASE}/facebook/bart-large-mnli`,
      {
        inputs: text.slice(0, 512),
        parameters: { candidate_labels: labels },
      },
      { headers: getHeaders(), timeout: 20000 }
    );

    if (res.data?.labels?.[0] && res.data.scores[0] > 0.3) {
      return res.data.labels[0];
    }
    return null;
  } catch {
    return null;
  }
}

export async function translateArabicToEnglish(text: string): Promise<string | null> {
  if (!isHuggingFaceConfigured()) return null;

  try {
    const res = await axios.post<Array<{ translation_text: string }>>(
      `${HF_BASE}/Helsinki-NLP/opus-mt-ar-en`,
      { inputs: text.slice(0, 512) },
      { headers: getHeaders(), timeout: 15000 }
    );
    return res.data?.[0]?.translation_text || null;
  } catch {
    return null;
  }
}
