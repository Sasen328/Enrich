const APOLLO_BASE = "https://api.apollo.io/api/v1";
const TIMEOUT_MS = 15000;

function getApiKey(): string | null {
  return process.env.APOLLO_API_KEY || null;
}

function getAccessToken(): string | null {
  return process.env.APOLLO_ACCESS_TOKEN || process.env.APOLLO_CLIENT_SECRET || null;
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function enrichCompanyWithApollo(
  domain?: string | null,
  name?: string | null
): Promise<{
  website?: string;
  employeeCount?: number;
  revenue?: string;
  phone?: string;
  city?: string;
  description?: string;
  industry?: string;
  linkedinUrl?: string;
  foundingYear?: number;
} | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  if (!domain && !name) return null;

  const params = new URLSearchParams();
  if (domain) params.set("domain", domain);
  else if (name) params.set("name", name);

  try {
    const res = await fetchWithTimeout(`${APOLLO_BASE}/organizations/enrich?${params}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": apiKey,
      },
    });

    if (!res.ok) return null;
    const data = await res.json() as Record<string, any>;
    const org = data.organization;
    if (!org) return null;

    return {
      website: org.website_url || org.primary_domain || undefined,
      employeeCount: org.estimated_num_employees || undefined,
      revenue: org.annual_revenue ? String(org.annual_revenue) : undefined,
      phone: org.phone || undefined,
      city: [org.city, org.state, org.country].filter(Boolean).join(", ") || undefined,
      description: org.short_description || undefined,
      industry: org.industry || undefined,
      linkedinUrl: org.linkedin_url || undefined,
      foundingYear: org.founded_year || undefined,
    };
  } catch (err) {
    console.error("Apollo enrichCompany error:", err);
    return null;
  }
}

export async function searchPeopleByDomain(
  domain: string,
  page = 1,
  perPage = 10
): Promise<Array<{
  apolloId: string;
  firstName: string;
  lastName: string;
  name: string;
  title: string;
  linkedinUrl: string;
  email: string;
  city: string;
  seniority: string;
}> | null> {
  const token = getAccessToken();
  if (!token) return null;

  try {
    const res = await fetchWithTimeout(`${APOLLO_BASE}/mixed_people/api_search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        q_organization_domains_list: [domain],
        organization_locations: ["Saudi Arabia"],
        page,
        per_page: perPage,
        person_seniorities: [
          "owner", "founder", "c_suite", "partner",
          "vp", "head", "director", "manager"
        ],
      }),
    });

    if (!res.ok) return null;
    const data = await res.json() as Record<string, any>;
    const people = data.people || [];

    return people.map((p: any) => ({
      apolloId: p.id || "",
      firstName: p.first_name || "",
      lastName: p.last_name || "",
      name: [p.first_name, p.last_name].filter(Boolean).join(" "),
      title: p.title || "",
      linkedinUrl: p.linkedin_url || "",
      email: p.email || "",
      city: p.city || "",
      seniority: p.seniority || "",
    }));
  } catch (err) {
    console.error("Apollo searchPeople error:", err);
    return null;
  }
}

export async function matchPerson(apolloPersonId: string): Promise<{
  name: string;
  title: string;
  linkedinUrl: string;
  email: string;
  phone: string;
  city: string;
  seniority: string;
} | null> {
  const token = getAccessToken();
  if (!token) return null;

  try {
    const res = await fetchWithTimeout(`${APOLLO_BASE}/people/match`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ id: apolloPersonId }),
    });

    if (!res.ok) return null;
    const data = await res.json() as Record<string, any>;
    const person = data.person;
    if (!person) return null;

    return {
      name: [person.first_name, person.last_name].filter(Boolean).join(" "),
      title: person.title || "",
      linkedinUrl: person.linkedin_url || "",
      email: person.email || "",
      phone: person.phone_number || "",
      city: person.city || "",
      seniority: person.seniority || "",
    };
  } catch (err) {
    console.error("Apollo matchPerson error:", err);
    return null;
  }
}

export async function searchNewCompanies(page = 1): Promise<Array<{
  name: string;
  website: string;
  domain: string;
  industry: string;
  employeeCount: number;
  city: string;
  linkedinUrl: string;
  description: string;
}> | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  try {
    const res = await fetchWithTimeout(`${APOLLO_BASE}/mixed_companies/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify({
        q_organization_keyword_tags: ["saudi arabia", "riyadh", "jeddah", "dammam"],
        organization_locations: ["Saudi Arabia"],
        page,
        per_page: 25,
        organization_num_employees_ranges: [
          "11,20", "21,50", "51,100", "101,200", "201,500",
          "501,1000", "1001,2000", "2001,5000", "5001,10000", "10001+"
        ],
      }),
    });

    if (!res.ok) return null;
    const data = await res.json() as Record<string, any>;
    const orgs = data.organizations || [];

    return orgs.map((o: any) => ({
      name: o.name || "",
      website: o.website_url || "",
      domain: o.primary_domain || "",
      industry: o.industry || "",
      employeeCount: o.estimated_num_employees || 0,
      city: [o.city, o.state].filter(Boolean).join(", ") || "",
      linkedinUrl: o.linkedin_url || "",
      description: o.short_description || "",
    }));
  } catch (err) {
    console.error("Apollo searchNewCompanies error:", err);
    return null;
  }
}
