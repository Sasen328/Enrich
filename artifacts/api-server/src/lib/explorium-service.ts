import axios from "axios";

const EXPLORIUM_BASE = "https://api.explorium.ai/v1";

function getApiKey(): string | null {
  return process.env.EXPLORIUM_API_KEY || null;
}

export function isExploriumConfigured(): boolean {
  return !!process.env.EXPLORIUM_API_KEY;
}

interface ExploriumCompanyResult {
  business_name?: string;
  website?: string;
  employee_count?: number;
  annual_revenue?: string;
  industry?: string;
  city?: string;
  country?: string;
  phone?: string;
  linkedin_url?: string;
  description?: string;
  founded_year?: number;
}

export async function enrichCompanyWithExplorium(
  domain?: string | null,
  name?: string | null,
  country = "Saudi Arabia"
): Promise<{
  website?: string;
  employeeCount?: number;
  revenue?: string;
  industry?: string;
  city?: string;
  phone?: string;
  linkedinUrl?: string;
  description?: string;
  foundingYear?: number;
} | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  if (!domain && !name) return null;

  try {
    const payload: Record<string, string> = { country };
    if (domain) payload.website = domain;
    if (name) payload.business_name = name;

    const res = await axios.post<{ data: ExploriumCompanyResult[] }>(
      `${EXPLORIUM_BASE}/businesses/enrich`,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          "api_key": apiKey,
        },
        timeout: 15000,
      }
    );

    const biz = res.data?.data?.[0];
    if (!biz) return null;

    return {
      website: biz.website,
      employeeCount: biz.employee_count,
      revenue: biz.annual_revenue,
      industry: biz.industry,
      city: biz.city,
      phone: biz.phone,
      linkedinUrl: biz.linkedin_url,
      description: biz.description,
      foundingYear: biz.founded_year,
    };
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      if (status === 401 || status === 403) {
        console.warn("Explorium API: authentication failed");
      } else if (status !== 404) {
        console.warn(`Explorium API error: ${status} - ${err.message}`);
      }
    }
    return null;
  }
}

interface ExploriumContactResult {
  full_name?: string;
  title?: string;
  email?: string;
  phone?: string;
  linkedin_url?: string;
  seniority?: string;
}

export async function findContactsWithExplorium(
  domain: string,
  limit = 5
): Promise<Array<{
  name?: string;
  title?: string;
  email?: string;
  phone?: string;
  linkedinUrl?: string;
}>> {
  const apiKey = getApiKey();
  if (!apiKey) return [];

  try {
    const res = await axios.post<{ data: ExploriumContactResult[] }>(
      `${EXPLORIUM_BASE}/contacts/search`,
      {
        website: domain,
        country: "Saudi Arabia",
        seniority: ["c_level", "vp", "director", "manager"],
        limit,
      },
      {
        headers: {
          "Content-Type": "application/json",
          "api_key": apiKey,
        },
        timeout: 15000,
      }
    );

    return (res.data?.data || []).map((c) => ({
      name: c.full_name,
      title: c.title,
      email: c.email,
      phone: c.phone,
      linkedinUrl: c.linkedin_url,
    }));
  } catch {
    return [];
  }
}
