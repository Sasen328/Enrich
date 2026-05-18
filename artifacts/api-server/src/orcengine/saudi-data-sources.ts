import { parseHtml, getPageContent } from "../browser-helper";

interface WathqCompanyData {
  crNumber?: string;
  companyName?: string;
  companyNameAr?: string;
  status?: string;
  capital?: string;
  activities?: string[];
  issueDate?: string;
  expiryDate?: string;
  location?: string;
  entityType?: string;
  owners?: string[];
  managers?: string[];
}

interface OpenDataCompanyRecord {
  name?: string;
  nameAr?: string;
  crNumber?: string;
  city?: string;
  region?: string;
  activity?: string;
  status?: string;
  capital?: string;
  registrationDate?: string;
}

interface AamalyDocument {
  title?: string;
  companyName?: string;
  documentType?: string;
  publishDate?: string;
  snippet?: string;
  url?: string;
}

interface WikidataCompany {
  name?: string;
  description?: string;
  founded?: string;
  headquarters?: string;
  industry?: string;
  website?: string;
  parentOrg?: string;
  subsidiaries?: string[];
  employees?: string;
  revenue?: string;
}

export interface SaudiSourcesResult {
  wathq?: WathqCompanyData;
  openData?: OpenDataCompanyRecord[];
  aamaly?: AamalyDocument[];
  wikidata?: WikidataCompany;
  rawText: string;
}

async function fetchWithTimeout(url: string, timeoutMs: number = 8000, options?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/json,application/xhtml+xml,*/*',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
        ...options?.headers,
      },
    });
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

async function searchWathq(companyName: string): Promise<WathqCompanyData | undefined> {
  try {
    const searchUrl = `https://mc.gov.sa/en/eservices/Pages/Commercial-data.aspx`;
    const html = await getPageContent(searchUrl, { waitMs: 4000 });
    const $ = parseHtml(html);
    const pageText = $('body').text().replace(/\s+/g, ' ').trim();
    if (pageText.length < 100) return undefined;

    const res = await fetchWithTimeout(
      `https://api.wathq.sa/v5/commercialregistration/search?name=${encodeURIComponent(companyName)}`,
      6000,
      { headers: { 'Accept': 'application/json' } }
    );
    if (res.ok) {
      const data = await res.json() as Record<string, unknown>;
      if (data && typeof data === 'object') {
        const items = (data as { items?: Record<string, unknown>[] }).items;
        if (Array.isArray(items) && items.length > 0) {
          const item = items[0];
          return {
            crNumber: String(item.crNumber || ''),
            companyName: String(item.companyName || item.name || ''),
            companyNameAr: String(item.companyNameAr || item.nameAr || ''),
            status: String(item.status || ''),
            capital: String(item.capital || ''),
            activities: Array.isArray(item.activities) ? (item.activities as string[]) : [],
            issueDate: String(item.issueDate || ''),
            expiryDate: String(item.expiryDate || ''),
            location: String(item.location || item.city || ''),
            entityType: String(item.entityType || ''),
          };
        }
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

async function searchMCOpenData(companyName: string): Promise<OpenDataCompanyRecord[]> {
  const records: OpenDataCompanyRecord[] = [];
  try {
    const searchUrls = [
      `https://open.data.gov.sa/en/datasets/view/ae36b578-d7b1-45ef-a1b1-e16b8e8ea1e6/resources`,
      `https://mc.gov.sa/en/OpenData/Pages/default.aspx`,
    ];

    for (const url of searchUrls) {
      try {
        const res = await fetchWithTimeout(url, 8000);
        if (res.ok) {
          const html = await res.text();
          const $ = parseHtml(html);

          const links: string[] = [];
          $('a[href]').each(function(this: unknown) {
            const href = $(this as never).attr('href') || '';
            if (href.match(/\.(csv|json|xlsx)/i) || href.includes('resource') || href.includes('download') || href.includes('api')) {
              links.push(href.startsWith('http') ? href : new URL(href, url).href);
            }
          });

          for (const link of links.slice(0, 3)) {
            try {
              const dataRes = await fetchWithTimeout(link, 6000);
              if (dataRes.ok) {
                const contentType = dataRes.headers.get('content-type') || '';
                if (contentType.includes('json')) {
                  const jsonData = await dataRes.json() as Record<string, unknown>[];
                  const items = Array.isArray(jsonData) ? jsonData : [];
                  for (const item of items.slice(0, 100)) {
                    if (typeof item === 'object' && item !== null) {
                      const name = String(item.name || item.companyName || item.company_name || '');
                      if (name && name.toLowerCase().includes(companyName.toLowerCase().split(' ')[0])) {
                        records.push({
                          name,
                          nameAr: String(item.nameAr || item.company_name_ar || ''),
                          crNumber: String(item.crNumber || item.cr_number || item.commercial_registration || ''),
                          city: String(item.city || item.region || ''),
                          activity: String(item.activity || item.sector || item.industry || ''),
                          status: String(item.status || ''),
                          capital: String(item.capital || ''),
                          registrationDate: String(item.registrationDate || item.registration_date || ''),
                        });
                      }
                    }
                  }
                } else if (contentType.includes('csv') || contentType.includes('text')) {
                  const csvText = await dataRes.text();
                  const lines = csvText.split('\n');
                  if (lines.length > 1) {
                    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
                    const nameIdx = headers.findIndex(h => h.includes('name') || h.includes('company'));
                    if (nameIdx >= 0) {
                      for (const line of lines.slice(1, 500)) {
                        const cols = line.split(',');
                        if (cols[nameIdx] && cols[nameIdx].toLowerCase().includes(companyName.toLowerCase().split(' ')[0])) {
                          records.push({
                            name: cols[nameIdx]?.trim(),
                            crNumber: cols[headers.findIndex(h => h.includes('cr') || h.includes('registration'))]?.trim(),
                            city: cols[headers.findIndex(h => h.includes('city') || h.includes('region'))]?.trim(),
                            activity: cols[headers.findIndex(h => h.includes('activity') || h.includes('sector'))]?.trim(),
                          });
                        }
                      }
                    }
                  }
                }
              }
            } catch { /* individual data file fetch failed */ }
          }

          if (records.length > 0) break;
        }
      } catch { /* individual search URL failed */ }
    }
  } catch { /* open data search failed entirely */ }
  return records.slice(0, 5);
}

async function searchAamaly(companyName: string): Promise<AamalyDocument[]> {
  const documents: AamalyDocument[] = [];
  try {
    const searchUrl = `https://emagazine.aamaly.sa/search?q=${encodeURIComponent(companyName)}`;

    let html = "";
    try {
      const res = await fetchWithTimeout(searchUrl, 8000);
      if (res.ok) {
        html = await res.text();
      }
    } catch {
      html = await getPageContent(searchUrl, { waitMs: 5000 });
    }

    if (html.length < 200) {
      html = await getPageContent(searchUrl, { waitMs: 5000 });
    }

    if (html) {
      const $ = parseHtml(html);
      $('script, style, noscript, svg, iframe').remove();

      const resultSelectors = [
        '.search-result', '.result-item', '.article-item', '.card', '.list-item',
        'article', '[class*="result"]', '[class*="item"]', 'tr', '.row'
      ];

      for (const selector of resultSelectors) {
        $(selector).each(function(this: unknown) {
          const el = $(this as never);
          const title = el.find('h2, h3, h4, a, .title, [class*="title"]').first().text().trim();
          const snippet = el.find('p, .snippet, .description, [class*="desc"]').first().text().trim();
          const link = el.find('a').first().attr('href') || '';
          const dateText = el.find('.date, time, [class*="date"]').first().text().trim();

          if (title && title.length > 5 && title.length < 500) {
            let docType = 'unknown';
            const titleLower = title.toLowerCase();
            if (titleLower.includes('عقد تأسيس') || titleLower.includes('articles of association') || titleLower.includes('constitution')) {
              docType = 'articles_of_association';
            } else if (titleLower.includes('قرار') || titleLower.includes('resolution') || titleLower.includes('decision')) {
              docType = 'shareholder_resolution';
            } else if (titleLower.includes('تعديل') || titleLower.includes('amendment') || titleLower.includes('modification')) {
              docType = 'amendment';
            } else if (titleLower.includes('تصفية') || titleLower.includes('liquidation') || titleLower.includes('dissolution')) {
              docType = 'liquidation';
            } else if (titleLower.includes('زيادة رأس المال') || titleLower.includes('capital increase')) {
              docType = 'capital_change';
            }

            documents.push({
              title,
              companyName,
              documentType: docType,
              publishDate: dateText || undefined,
              snippet: snippet.substring(0, 300) || undefined,
              url: link ? (link.startsWith('http') ? link : `https://emagazine.aamaly.sa${link}`) : undefined,
            });
          }
        });
        if (documents.length > 0) break;
      }

      if (documents.length === 0) {
        const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
        if (bodyText.length > 100) {
          documents.push({
            title: 'Search results page',
            companyName,
            documentType: 'search_results',
            snippet: bodyText.substring(0, 500),
          });
        }
      }
    }
  } catch { /* aamaly search failed */ }
  return documents.slice(0, 5);
}

async function searchWikidata(companyName: string): Promise<WikidataCompany | undefined> {
  try {
    const sparql = `
SELECT ?company ?companyLabel ?companyDescription ?founded ?hqLabel ?industryLabel ?website ?parentLabel ?employees ?revenue WHERE {
  ?company wdt:P31/wdt:P279* wd:Q4830453.
  ?company wdt:P17 wd:Q851.
  ?company rdfs:label ?label.
  FILTER(LANG(?label) = "en" || LANG(?label) = "ar")
  FILTER(CONTAINS(LCASE(?label), "${companyName.toLowerCase().split(' ')[0]}"))
  OPTIONAL { ?company wdt:P571 ?founded }
  OPTIONAL { ?company wdt:P159 ?hq }
  OPTIONAL { ?company wdt:P452 ?industry }
  OPTIONAL { ?company wdt:P856 ?website }
  OPTIONAL { ?company wdt:P749 ?parent }
  OPTIONAL { ?company wdt:P1128 ?employees }
  OPTIONAL { ?company wdt:P2139 ?revenue }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,ar". }
}
LIMIT 5`;

    const wikidataUrl = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`;
    const res = await fetchWithTimeout(wikidataUrl, 10000, {
      headers: { 'Accept': 'application/sparql-results+json' },
    });

    if (res.ok) {
      const data = await res.json() as { results?: { bindings?: Record<string, { value?: string }>[] } };
      const bindings = data?.results?.bindings;
      if (Array.isArray(bindings) && bindings.length > 0) {
        const b = bindings[0];
        return {
          name: b.companyLabel?.value || companyName,
          description: b.companyDescription?.value,
          founded: b.founded?.value ? new Date(b.founded.value).getFullYear().toString() : undefined,
          headquarters: b.hqLabel?.value,
          industry: b.industryLabel?.value,
          website: b.website?.value,
          parentOrg: b.parentLabel?.value,
          employees: b.employees?.value,
          revenue: b.revenue?.value,
        };
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export async function fetchSaudiSources(companyName: string, options?: { skipSlow?: boolean }): Promise<SaudiSourcesResult> {
  const startTime = Date.now();
  console.log(`[SaudiSources] Searching for "${companyName}" across Saudi government sources...`);

  const promises: [
    Promise<WathqCompanyData | undefined>,
    Promise<OpenDataCompanyRecord[]>,
    Promise<AamalyDocument[]>,
    Promise<WikidataCompany | undefined>,
  ] = [
    searchWathq(companyName).catch(() => undefined),
    options?.skipSlow ? Promise.resolve([]) : searchMCOpenData(companyName).catch(() => []),
    searchAamaly(companyName).catch(() => []),
    searchWikidata(companyName).catch(() => undefined),
  ];

  const [wathq, openData, aamaly, wikidata] = await Promise.all(promises);

  const parts: string[] = [];
  if (wathq) {
    parts.push(`[Wathq/MC Registry] Name: ${wathq.companyName || wathq.companyNameAr}, CR#: ${wathq.crNumber}, Status: ${wathq.status}, Capital: ${wathq.capital}, Type: ${wathq.entityType}, Activities: ${(wathq.activities || []).join(', ')}, Location: ${wathq.location}, Issued: ${wathq.issueDate}`);
    if (wathq.owners && wathq.owners.length > 0) parts.push(`Owners: ${wathq.owners.join(', ')}`);
    if (wathq.managers && wathq.managers.length > 0) parts.push(`Managers: ${wathq.managers.join(', ')}`);
  }
  if (openData && openData.length > 0) {
    for (const r of openData) {
      parts.push(`[Open Data CR] Name: ${r.name || r.nameAr}, CR#: ${r.crNumber}, City: ${r.city}, Activity: ${r.activity}, Capital: ${r.capital}, Registered: ${r.registrationDate}`);
    }
  }
  if (aamaly && aamaly.length > 0) {
    for (const d of aamaly) {
      parts.push(`[Aamaly e-Gazette] Type: ${d.documentType}, Title: ${d.title}, Date: ${d.publishDate || 'N/A'}, Snippet: ${d.snippet || 'N/A'}`);
    }
  }
  if (wikidata) {
    parts.push(`[Wikidata] Name: ${wikidata.name}, Founded: ${wikidata.founded || 'N/A'}, HQ: ${wikidata.headquarters || 'N/A'}, Industry: ${wikidata.industry || 'N/A'}, Website: ${wikidata.website || 'N/A'}, Parent: ${wikidata.parentOrg || 'N/A'}, Employees: ${wikidata.employees || 'N/A'}, Revenue: ${wikidata.revenue || 'N/A'}`);
  }

  const sourcesFound = [
    wathq ? 'Wathq' : null,
    openData && openData.length > 0 ? 'OpenData' : null,
    aamaly && aamaly.length > 0 ? 'Aamaly' : null,
    wikidata ? 'Wikidata' : null,
  ].filter(Boolean);

  console.log(`[SaudiSources] "${companyName}": found data from ${sourcesFound.length} sources (${sourcesFound.join(', ')}) in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

  return {
    wathq: wathq || undefined,
    openData: openData.length > 0 ? openData : undefined,
    aamaly: aamaly.length > 0 ? aamaly : undefined,
    wikidata: wikidata || undefined,
    rawText: parts.join('\n'),
  };
}
