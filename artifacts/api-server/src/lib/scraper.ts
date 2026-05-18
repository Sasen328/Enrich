import axios from "axios";

export interface ScrapedContact {
  phone?: string;
  email?: string;
  website?: string;
}

export interface ScrapedCompanyData {
  nameAr?: string;
  nameEn?: string;
  industry?: string;
  city?: string;
  phone?: string;
  email?: string;
  website?: string;
  description?: string;
}

function isValidSaudiPhone(phone: string): boolean {
  const cleaned = phone.replace(/[\s\-\(\)\.]/g, "");
  if (/(\d)\1{4,}/.test(cleaned)) return false;
  if (/1234567|7654321|0123456/.test(cleaned)) return false;
  if ((cleaned.match(/0/g) || []).length >= 5) return false;
  const saudiMobile = /^(\+966|00966|966|0)(5\d{8})$/;
  const saudiLandline = /^(\+966|00966|966|0)(1[1-9]\d{6}|[2-9]\d{7})$/;
  return saudiMobile.test(cleaned) || saudiLandline.test(cleaned);
}

function isValidEmail(email: string): boolean {
  if (email.toLowerCase().includes("estimated")) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function isValidWebsite(url: string): boolean {
  if (url.toLowerCase().includes("estimated")) return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export async function scrapeWebsiteContacts(url: string): Promise<ScrapedContact> {
  try {
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ProspectSA/1.0; +https://prospectsa.com/bot)",
      },
    });
    const html = response.data as string;
    const contacts: ScrapedContact = {};

    const phonePatterns = [
      /(?:tel:|phone:|هاتف:|جوال:|فاكس:)?\s*(\+966[\s\-]?[0-9]{8,9})/gi,
      /(?:tel:|phone:|هاتف:|جوال:)?\s*(0[15][0-9]{8})/gi,
      /(?:tel:|phone:|هاتف:|جوال:)?\s*(01[1-9][0-9]{6})/gi,
    ];
    for (const pattern of phonePatterns) {
      const match = html.match(pattern);
      if (match) {
        const phone = match[0].replace(/[^\d+]/g, "");
        if (isValidSaudiPhone(phone)) {
          contacts.phone = phone;
          break;
        }
      }
    }

    const emailPattern = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
    const emails = html.match(emailPattern) || [];
    for (const email of emails) {
      if (isValidEmail(email) && !email.includes("example.com") && !email.includes("test.com")) {
        contacts.email = email;
        break;
      }
    }

    return contacts;
  } catch {
    return {};
  }
}

export async function validateWebsiteIsReal(url: string): Promise<boolean> {
  if (!url || !isValidWebsite(url)) return false;
  try {
    const response = await axios.head(url, { timeout: 8000, maxRedirects: 3 });
    return response.status < 400;
  } catch {
    try {
      const response = await axios.get(url, { timeout: 8000, maxRedirects: 3 });
      return response.status < 400;
    } catch {
      return false;
    }
  }
}

export function validateAndCleanData(company: Record<string, unknown>): Record<string, unknown> {
  const cleaned = { ...company };

  if (cleaned.phone && typeof cleaned.phone === "string") {
    if (!isValidSaudiPhone(cleaned.phone)) {
      cleaned.phone = null;
    }
  }

  if (cleaned.ownerPhone && typeof cleaned.ownerPhone === "string") {
    if (!isValidSaudiPhone(cleaned.ownerPhone)) {
      cleaned.ownerPhone = null;
    }
  }

  if (cleaned.email && typeof cleaned.email === "string") {
    if (!isValidEmail(cleaned.email)) {
      cleaned.email = null;
    }
  }

  if (cleaned.ownerEmail && typeof cleaned.ownerEmail === "string") {
    if (!isValidEmail(cleaned.ownerEmail)) {
      cleaned.ownerEmail = null;
    }
  }

  if (cleaned.website && typeof cleaned.website === "string") {
    if (!isValidWebsite(cleaned.website)) {
      cleaned.website = null;
    }
  }

  return cleaned;
}

export async function fetchUrl(url: string): Promise<string> {
  const response = await axios.get(url, {
    timeout: 15000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ar,en;q=0.5",
    },
  });
  return response.data as string;
}

export async function fetchWikidataSaudiCompanies(): Promise<ScrapedCompanyData[]> {
  const sparqlQuery = `
    SELECT DISTINCT ?company ?companyLabel ?companyLabelAr ?industry ?industryLabel ?hq ?hqLabel ?employees ?revenue ?website WHERE {
      ?company wdt:P31 wd:Q4830453 .
      ?company wdt:P17 wd:Q851 .
      OPTIONAL { ?company wdt:P452 ?industry . }
      OPTIONAL { ?company wdt:P159 ?hq . }
      OPTIONAL { ?company wdt:P1128 ?employees . }
      OPTIONAL { ?company wdt:P2139 ?revenue . }
      OPTIONAL { ?company wdt:P856 ?website . }
      SERVICE wikibase:label {
        bd:serviceParam wikibase:language "en,ar" .
        ?company rdfs:label ?companyLabel .
        ?industry rdfs:label ?industryLabel .
        ?hq rdfs:label ?hqLabel .
      }
      OPTIONAL {
        ?company rdfs:label ?companyLabelAr .
        FILTER(LANG(?companyLabelAr) = "ar")
      }
    }
    LIMIT 500
  `;

  try {
    const response = await axios.get("https://query.wikidata.org/sparql", {
      params: { query: sparqlQuery, format: "json" },
      headers: {
        "Accept": "application/sparql-results+json",
        "User-Agent": "ProspectSA/1.0 (Saudi B2B Intelligence; contact@prospectsa.com)",
      },
      timeout: 30000,
    });

    const bindings = response.data?.results?.bindings || [];
    return bindings.map((b: Record<string, { value: string }>) => ({
      nameEn: b.companyLabel?.value,
      nameAr: b.companyLabelAr?.value,
      industry: b.industryLabel?.value,
      city: b.hqLabel?.value,
      website: b.website?.value,
      employeeCount: b.employees?.value ? parseInt(b.employees.value) : undefined,
    }));
  } catch {
    return [];
  }
}
