import * as XLSX from "xlsx";
import { openai } from "../openai-client";

export type ExportFormat = 'pdf' | 'word' | 'excel' | 'ppt' | 'json' | 'txt' | 'csv';

interface ExportResult {
  format: ExportFormat;
  content: string;
  mimeType: string;
  filename: string;
}

interface ExecutiveEntry {
  name?: string;
  arabicName?: string;
  title?: string;
  position?: string;
  department?: string;
  background?: string;
  bio?: string;
  linkedin?: string;
  email?: string;
  estimatedCompensation?: string;
  role?: string;
}

interface ShareholderEntry {
  name?: string;
  arabicName?: string;
  percentage?: string;
  type?: string;
}

interface SourceEntry {
  url?: string;
  title?: string;
  content?: string;
  confidence?: number | string;
}

interface PersonTableEntry {
  name?: string;
  fullName?: string;
  title?: string;
  company?: string;
  netWorth?: string;
  estimatedIncome?: string;
  source?: string;
  [key: string]: string | undefined;
}

interface SwotAnalysis {
  strengths?: string[];
  weaknesses?: string[];
  opportunities?: string[];
  threats?: string[];
}

interface ReportData {
  companyOverview?: Record<string, unknown>;
  leadership?: {
    executiveTeam?: ExecutiveEntry[];
    boardOfDirectors?: ExecutiveEntry[];
  };
  executivesTable?: ExecutiveEntry[];
  financials?: Record<string, string>;
  workforce?: Record<string, string | string[]>;
  ownership?: {
    ownershipType?: string;
    publicFloat?: string;
    governmentStake?: string;
    familyOwnership?: string;
    majorShareholders?: ShareholderEntry[];
  };
  swotAnalysis?: SwotAnalysis;
  aiAnalysis?: Record<string, string | string[]>;
  contactInfo?: Record<string, string>;
  socialMedia?: Record<string, string>;
  keyInsights?: string[];
  sections?: Array<{ title?: string; heading?: string; content?: string; citations?: string[] }>;
  sources?: SourceEntry[];
  dataSources?: SourceEntry[];
  peopleTable?: PersonTableEntry[];
  careerHistory?: Array<Record<string, string>>;
  experience?: Array<Record<string, string>>;
  education?: Array<Record<string, string>>;
  boardPositions?: Array<Record<string, string>>;
  personalInfo?: Record<string, string>;
  businessInterests?: Record<string, unknown>;
  philanthropicActivities?: Record<string, unknown>;
  competitiveLandscape?: { directCompetitors?: Array<Record<string, string>> };
  [key: string]: unknown;
}

const REPORT_STRUCTURE = `
# COMPANY INTELLIGENCE REPORT

## 1. EXECUTIVE SUMMARY
- Company at a Glance
- Key Findings
- Investment Grade Rating

## 2. COMPANY PROFILE
### 2.1 Basic Information
- Legal Name / Arabic Name
- Founded Year
- Company Type (Public/Private)
- Registration Number (CR)
- Headquarters Address
- Phone / Email / Website

### 2.2 Ownership & Shareholders
- Owner / Major Shareholders
- Shareholding Structure
- Public Float (if listed)

### 2.3 Stock Information (if listed)
- Exchange (TASI/NoMU)
- Ticker Symbol
- Market Capitalization
- 52-Week High/Low
- Current Price

## 3. LEADERSHIP & GOVERNANCE
### 3.1 Board of Directors
- Chairman
- Board Members with backgrounds

### 3.2 Executive Management
- CEO/MD Profile
- CFO Profile
- Other C-Suite Executives
- Estimated Executive Compensation

### 3.3 Founder Profile
- Background
- Other Ventures

## 4. BUSINESS OPERATIONS
### 4.1 Company Description
- What the company does
- Business Model
- Value Proposition

### 4.2 Products & Services
- Main Products/Services
- Revenue Streams
- Target Markets

### 4.3 Workforce
- Total Employees
- Employee Growth Rate
- Saudization Rate
- Key Departments

## 5. FINANCIAL ANALYSIS
### 5.1 Revenue & Profitability
- Annual Revenue
- Revenue Growth (YoY)
- Net Income
- Profit Margin
- EBITDA

### 5.2 Financial Position
- Total Assets
- Total Liabilities
- Debt/Equity Ratio
- Working Capital

### 5.3 Funding History
- Investment Rounds
- Key Investors

## 6. MARKET POSITION
### 6.1 Industry Overview
- Industry Size
- Growth Rate
- Key Trends

### 6.2 Competitive Landscape
- Direct Competitors
- Market Share
- Competitive Advantages
- Competitive Weaknesses

### 6.3 Comparison with Competitors
| Metric | Company | Competitor 1 | Competitor 2 |
|--------|---------|--------------|--------------|
| Revenue | | | |
| Employees | | | |
| Market Share | | | |

## 7. SWOT ANALYSIS
### Strengths
### Weaknesses
### Opportunities
### Threats

## 8. VISION 2030 ALIGNMENT
- Relevant Pillars
- Government Initiatives
- Strategic Partnerships

## 9. CONTACT INFORMATION
- Headquarters Address
- Phone Numbers
- Email Addresses
- Social Media URLs (LinkedIn, Twitter, etc.)
- Investor Relations Contact

## 10. AI INSIGHTS & RECOMMENDATIONS
### Investment Outlook
### Growth Potential
### Risk Factors
### Strategic Recommendations
### Partnership Opportunities

## 11. SOURCES
- Data sources used
- Confidence scores
`;

export async function generateStructuredReport(
  reportData: any,
  companyName: string,
  format: ExportFormat
): Promise<ExportResult> {
  if (format === 'excel') {
    const excelContent = generateMultiSheetExcel(reportData, companyName);
    return {
      format,
      content: excelContent,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: `${companyName.replace(/[^a-zA-Z0-9]/g, '_')}_Report.xlsx`,
    };
  }
  
  if (format === 'txt') {
    const txtContent = generatePlainTextReport(reportData, companyName);
    return {
      format,
      content: txtContent,
      mimeType: 'text/plain',
      filename: `${companyName.replace(/[^a-zA-Z0-9]/g, '_')}_Report.txt`,
    };
  }
  
  const reportContent = await formatReportWithAI(reportData, companyName, format);
  
  const mimeTypes: Record<ExportFormat, string> = {
    pdf: 'text/html',
    word: 'text/html',
    excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'text/html',
    json: 'application/json',
    txt: 'text/plain',
    csv: 'text/csv',
  };
  
  const extensions: Record<ExportFormat, string> = {
    pdf: 'html',
    word: 'html',
    excel: 'xlsx',
    ppt: 'html',
    json: 'json',
    txt: 'txt',
    csv: 'csv',
  };
  
  return {
    format,
    content: reportContent,
    mimeType: mimeTypes[format],
    filename: `${companyName.replace(/[^a-zA-Z0-9]/g, '_')}_Report.${extensions[format]}`,
  };
}

// Generate multi-sheet Excel workbook for enrichment/research reports
function generateMultiSheetExcel(reportData: any, companyName: string): string {
  const rd = reportData as any;
  const workbook = XLSX.utils.book_new();
  
  // Helper to create sheets
  const addSheet = (data: Record<string, string | number>[], sheetName: string) => {
    if (!data || data.length === 0) return;
    const worksheet = XLSX.utils.json_to_sheet(data);
    const headers = Object.keys(data[0] || {});
    worksheet['!cols'] = headers.map(h => {
      let maxLen = h.length;
      data.forEach(row => {
        const val = row[h];
        if (val) maxLen = Math.max(maxLen, Math.min(String(val).length, 60));
      });
      return { wch: maxLen + 2 };
    });
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  };

  // 1. Executive Summary
  addSheet([{
    "Report Title": `${companyName} Intelligence Report`,
    "Generated Date": new Date().toLocaleString(),
    "Summary": reportData.profileSummary || (reportData as any).summary || 'N/A',
    "Confidence Score": (reportData as any).metadata?.confidenceScore || (reportData as any).confidenceScore || 'N/A'
  }], "Executive Summary");

  // 2. Company Profile
  const overview = (reportData.companyOverview || {}) as any;
  addSheet([{
    "Legal Name": overview.legalName || companyName,
    "Arabic Name": overview.arabicName || (reportData as any).arabicName || 'N/A',
    "Trading Name": overview.tradingName || 'N/A',
    "Founded": overview.founded || 'N/A',
    "Company Type": overview.companyType || 'N/A',
    "Registration Number": overview.registrationNumber || 'N/A',
    "Headquarters": typeof overview.headquarters === 'object' 
      ? [(overview as any)?.headquarters?.address, (overview.headquarters as any)?.city, (overview.headquarters as any)?.country].filter(Boolean).join(', ')
      : (overview.headquarters || 'N/A'),
    "Website": (reportData as any).contactInfo?.website || 'N/A',
    "Phone": (reportData as any).contactInfo?.phone || 'N/A',
    "Email": (reportData as any).contactInfo?.email || 'N/A',
    "Industry": (reportData as any).industry || overview.industry || 'N/A',
    "Founders": Array.isArray(overview.founders) ? overview.founders.join(', ') : (overview.founders || 'N/A'),
  }], "Company Profile");

  // 3. Stock Information
  if (overview.stockInfo) {
    addSheet([{
      "Exchange": (overview as any)?.stockInfo?.exchange || 'N/A',
      "Ticker": (overview as any)?.stockInfo?.ticker || 'N/A',
      "Market Cap": (overview as any)?.stockInfo?.marketCap || 'N/A',
      "Current Price": (overview as any)?.stockInfo?.currentPrice || 'N/A',
      "52-Week High": (overview as any)?.stockInfo?.weekHigh52 || 'N/A',
      "52-Week Low": (overview as any)?.stockInfo?.weekLow52 || 'N/A',
    }], "Stock Information");
  }

  // 4. Leadership & Executives
  const executivesTable = reportData.leadership?.executiveTeam || reportData.executivesTable || [];
  const boardMembers = reportData.leadership?.boardOfDirectors || [];
  const leadershipData = [
    ...executivesTable.filter(Boolean).map((e: ExecutiveEntry) => ({
      "Name": e.name || 'N/A',
      "Arabic Name": e.arabicName || 'N/A',
      "Title": e.title || e.position || 'N/A',
      "Department": e.department || 'N/A',
      "Background": e.background || e.bio || 'N/A',
      "LinkedIn": e.linkedin || 'N/A',
      "Email": e.email || 'N/A',
      "Est. Compensation": e.estimatedCompensation || 'N/A',
      "Role Type": "Executive"
    })),
    ...boardMembers.filter(Boolean).map((b: ExecutiveEntry) => ({
      "Name": b.name || 'N/A',
      "Arabic Name": b.arabicName || 'N/A',
      "Title": b.title || b.role || 'Board Member',
      "Department": 'Board',
      "Background": b.background || b.bio || 'N/A',
      "LinkedIn": b.linkedin || 'N/A',
      "Email": b.email || 'N/A',
      "Est. Compensation": b.estimatedCompensation || 'N/A',
      "Role Type": "Board"
    }))
  ];
  if (leadershipData.length > 0) addSheet(leadershipData, "Leadership");

  // 5. Financials
  const financials = (reportData.financials || {}) as any;
  addSheet([{
    "Annual Revenue": financials.annualRevenue || financials.revenue || 'N/A',
    "Revenue Growth": financials.revenueGrowth || 'N/A',
    "Net Income": financials.netIncome || 'N/A',
    "Profit Margin": financials.profitMargin || 'N/A',
    "Total Assets": financials.totalAssets || 'N/A',
    "Total Liabilities": financials.totalLiabilities || 'N/A',
    "EBITDA": financials.ebitda || 'N/A',
    "Funding Raised": financials.fundingRaised || 'N/A'
  }], "Financials");

  // 6. Workforce
  const workforce = (reportData.workforce || {}) as any;
  addSheet([{
    "Total Employees": workforce.totalEmployees || 'N/A',
    "Employee Growth": workforce.employeeGrowth || 'N/A',
    "Saudization Rate": workforce.saudiNationalsPercentage || workforce.saudizationRate || 'N/A',
    "Key Departments": Array.isArray(workforce.keyDepartments) ? workforce.keyDepartments.join(', ') : (workforce.keyDepartments || 'N/A')
  }], "Workforce");

  // 7. Ownership
  const ownership = (reportData.ownership || {}) as any;
  const shareholders = ownership.majorShareholders || [];
  if (shareholders.length > 0) {
    addSheet(shareholders.map((s: ShareholderEntry) => ({
      "Shareholder": s.name || 'N/A',
      "Arabic Name": s.arabicName || 'N/A',
      "Percentage": s.percentage || 'N/A',
      "Type": s.type || 'N/A'
    })), "Ownership");
  } else {
    addSheet([{
      "Ownership Type": ownership.ownershipType || 'N/A',
      "Public Float": ownership.publicFloat || 'N/A',
      "Government Stake": ownership.governmentStake || 'N/A',
      "Family Ownership": ownership.familyOwnership || 'N/A'
    }], "Ownership");
  }

  // 8. SWOT Analysis
  const swot = (reportData.swotAnalysis || {}) as any;
  const maxLen = Math.max(
    (swot.strengths || []).length,
    (swot.weaknesses || []).length,
    (swot.opportunities || []).length,
    (swot.threats || []).length,
    1
  );
  const swotData: Record<string, string>[] = [];
  for (let i = 0; i < maxLen; i++) {
    swotData.push({
      "Strengths": swot.strengths?.[i] || '',
      "Weaknesses": swot.weaknesses?.[i] || '',
      "Opportunities": swot.opportunities?.[i] || '',
      "Threats": swot.threats?.[i] || ''
    });
  }
  addSheet(swotData, "SWOT Analysis");

  // 9. AI Insights
  const aiAnalysis = (reportData.aiAnalysis || {}) as any;
  addSheet([{
    "Investment Outlook": aiAnalysis.investmentOutlook || 'N/A',
    "Growth Potential": aiAnalysis.growthPotential || 'N/A',
    "Risk Factors": Array.isArray(aiAnalysis.riskFactors) ? aiAnalysis.riskFactors.join('; ') : (aiAnalysis.riskFactors || 'N/A'),
    "Recommendations": Array.isArray(aiAnalysis.strategicRecommendations) 
      ? aiAnalysis.strategicRecommendations.join('; ') 
      : (aiAnalysis.strategicRecommendations || 'N/A'),
    "Key Insights": Array.isArray(reportData.keyInsights) ? reportData.keyInsights.join('; ') : 'N/A'
  }], "AI Insights");

  // 10. Contact Info
  const contact = (reportData as any).contactInfo || {};
  const social = reportData.socialMedia || {};
  addSheet([{
    "Phone": (contact as any).phone || (contact as any).generalPhone || 'N/A',
    "Email": (contact as any).email || 'N/A',
    "Website": (contact as any).website || 'N/A',
    "Investor Relations": typeof (contact as any).investorRelations === 'object' 
      ? (contact as any).investorRelations?.email 
      : ((contact as any).investorRelations || 'N/A'),
    "LinkedIn": social.linkedin?.url || 'N/A',
    "Twitter": social.twitter?.url || 'N/A'
  }], "Contact Info");

  // 11. People Table (for research reports)
  if (reportData.peopleTable && reportData.peopleTable.length > 0) {
    addSheet(reportData.peopleTable.map((p: PersonTableEntry) => ({
      "Full Name": p.fullName || 'N/A',
      "Title": p.title || 'N/A',
      "Company": p.company || 'N/A',
      "Est. Income": p.estimatedIncome || 'N/A',
      "LinkedIn": p.linkedinUrl || 'N/A',
      "Experience": p.yearsExperience || 'N/A',
      "Interests": p.interests || 'N/A',
      "Profile Summary": p.profileSummary || 'N/A',
      "Approach Strategy": p.approachStrategy || 'N/A',
      "Source URL": p.sourceUrl || 'N/A'
    })), "Executive Directory");
  }

  // 12. Report Sections (for research reports)
  if (reportData.sections && reportData.sections.length > 0) {
    type SectionEntry = { title?: string; heading?: string; content?: string; citations?: string[] };
    const sectionsData = reportData.sections
      .filter((s: SectionEntry) => s.content && String(s.content).trim().length > 10)
      .map((s: SectionEntry, idx: number) => ({
        "Section #": idx + 1,
        "Heading": typeof s.heading === 'object' ? JSON.stringify(s.heading) : (s.heading || s.title || ''),
        "Content": typeof s.content === 'object' ? JSON.stringify(s.content) : (s.content || ''),
        "Citations": Array.isArray(s.citations) ? s.citations.join(', ') : 'N/A'
      }));
    if (sectionsData.length > 0) addSheet(sectionsData, "Detailed Analysis");
  }

  // 13. Data Sources
  const sources = reportData.sources || reportData.dataSources || [];
  if (Array.isArray(sources) && sources.length > 0) {
    addSheet(sources.map((s: SourceEntry) => ({
      "Source": s.title || s.url || 'Unknown',
      "URL": s.url || 'N/A',
      "Confidence": String(s.confidence || 'N/A'),
    })), "Sources");
  }

  // Write to base64 string for transfer
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'base64' });
  return buffer;
}

function generatePlainTextReport(reportData: any, companyName: string): string {
  const rd = reportData as any;
  const _d = rd;
  const data = reportData || {};
  const lines: string[] = [];
  const divider = '='.repeat(60);
  const subDivider = '-'.repeat(40);

  lines.push(divider);
  lines.push(`  ${companyName.toUpperCase()} - INTELLIGENCE REPORT`);
  lines.push(`  Generated: ${new Date().toLocaleString()}`);
  lines.push(divider);
  lines.push('');

  if (data.profileSummary || data.summary) {
    lines.push('EXECUTIVE SUMMARY');
    lines.push(subDivider);
    lines.push(data.profileSummary || data.summary);
    lines.push('');
  }

  const overview = data.companyOverview || {};
  lines.push('1. COMPANY PROFILE');
  lines.push(subDivider);
  if (overview.legalName) lines.push(`  Legal Name:      ${overview.legalName}`);
  if (overview.arabicName) lines.push(`  Arabic Name:     ${overview.arabicName}`);
  if (overview.founded) lines.push(`  Founded:         ${overview.founded}`);
  if (overview.companyType) lines.push(`  Company Type:    ${overview.companyType}`);
  const hq = overview.headquarters;
  if (hq) lines.push(`  Headquarters:    ${typeof hq === 'object' ? [hq.city, hq.country].filter(Boolean).join(', ') : hq}`);
  if (data.industry || overview.industry) lines.push(`  Industry:        ${data.industry || overview.industry}`);
  if (Array.isArray(overview.founders) && overview.founders.length) lines.push(`  Founders:        ${overview.founders.join(', ')}`);
  lines.push('');

  if (overview.stockInfo) {
    lines.push('2. STOCK INFORMATION');
    lines.push(subDivider);
    const s = overview.stockInfo;
    if (s.exchange) lines.push(`  Exchange:        ${s.exchange}`);
    if (s.ticker) lines.push(`  Ticker:          ${s.ticker}`);
    if (s.marketCap) lines.push(`  Market Cap:      ${s.marketCap}`);
    if (s.currentPrice) lines.push(`  Current Price:   ${s.currentPrice}`);
    lines.push('');
  }

  const executivesTable = data.leadership?.executiveTeam || data.executivesTable || [];
  const board = data.leadership?.boardOfDirectors || [];
  if (executivesTable.length > 0 || board.length > 0) {
    lines.push('3. LEADERSHIP & EXECUTIVES');
    lines.push(subDivider);
    [...executivesTable, ...board].filter(Boolean).forEach((e: ExecutiveEntry) => {
      lines.push(`  ${e.name || 'Unknown'} - ${e.title || e.position || e.role || 'N/A'}`);
      if (e.background || e.bio) lines.push(`    ${(String(e.background ?? e.bio ?? '')).slice(0, 150)}`);
    });
    lines.push('');
  }

  const fin = data.financials || {};
  if (fin.annualRevenue || fin.revenue || fin.netIncome) {
    lines.push('4. FINANCIALS');
    lines.push(subDivider);
    if (fin.annualRevenue || fin.revenue) lines.push(`  Annual Revenue:  ${fin.annualRevenue || fin.revenue}`);
    if (fin.revenueGrowth) lines.push(`  Revenue Growth:  ${fin.revenueGrowth}`);
    if (fin.netIncome) lines.push(`  Net Income:      ${fin.netIncome}`);
    if (fin.profitMargin) lines.push(`  Profit Margin:   ${fin.profitMargin}`);
    if (fin.totalAssets) lines.push(`  Total Assets:    ${fin.totalAssets}`);
    if (fin.ebitda) lines.push(`  EBITDA:          ${fin.ebitda}`);
    lines.push('');
  }

  const workforce = data.workforce || {};
  if (workforce.totalEmployees) {
    lines.push('5. WORKFORCE');
    lines.push(subDivider);
    lines.push(`  Total Employees: ${workforce.totalEmployees}`);
    if (workforce.saudiNationalsPercentage || workforce.saudizationRate) {
      lines.push(`  Saudization:     ${workforce.saudiNationalsPercentage || workforce.saudizationRate}`);
    }
    lines.push('');
  }

  const swot = data.swotAnalysis || {};
  if (swot.strengths || swot.weaknesses || swot.opportunities || swot.threats) {
    lines.push('6. SWOT ANALYSIS');
    lines.push(subDivider);
    if (swot.strengths?.length) {
      lines.push('  Strengths:');
      swot.strengths.forEach((s: string) => lines.push(`    + ${s}`));
    }
    if (swot.weaknesses?.length) {
      lines.push('  Weaknesses:');
      swot.weaknesses.forEach((w: string) => lines.push(`    - ${w}`));
    }
    if (swot.opportunities?.length) {
      lines.push('  Opportunities:');
      swot.opportunities.forEach((o: string) => lines.push(`    > ${o}`));
    }
    if (swot.threats?.length) {
      lines.push('  Threats:');
      swot.threats.forEach((t: string) => lines.push(`    ! ${t}`));
    }
    lines.push('');
  }

  const ai = data.aiAnalysis || {};
  if (ai.investmentOutlook || ai.growthPotential) {
    lines.push('7. AI INSIGHTS');
    lines.push(subDivider);
    if (ai.investmentOutlook) lines.push(`  Investment Outlook: ${ai.investmentOutlook}`);
    if (ai.growthPotential) lines.push(`  Growth Potential:   ${ai.growthPotential}`);
    if (Array.isArray(ai.riskFactors)) lines.push(`  Risk Factors:       ${ai.riskFactors.join('; ')}`);
    if (Array.isArray(ai.strategicRecommendations)) lines.push(`  Recommendations:    ${ai.strategicRecommendations.join('; ')}`);
    lines.push('');
  }

  if (data.sections && data.sections.length > 0) {
    lines.push('DETAILED ANALYSIS');
    lines.push(subDivider);
    data.sections.filter((s: any) => s.content).forEach((s: any, i: number) => {
      const heading = typeof s.heading === 'object' ? JSON.stringify(s.heading) : s.heading;
      lines.push(`  ${i + 1}. ${heading || 'Section'}`);
      const content = typeof s.content === 'object' ? JSON.stringify(s.content) : s.content;
      lines.push(`     ${content}`);
      lines.push('');
    });
  }

  const sources = data.sources || data.dataSources || [];
  if (Array.isArray(sources) && sources.length > 0) {
    lines.push('DATA SOURCES');
    lines.push(subDivider);
    sources.forEach((s: SourceEntry) => {
      lines.push(`  ${s.title || s.url || 'Unknown'} ${s.url ? `(${s.url})` : ''}`);
    });
    lines.push('');
  }

  lines.push(divider);
  lines.push('  Report generated by OrcEngine Intelligence Platform');
  lines.push(divider);

  return lines.join('\n');
}

async function formatReportWithAI(
  reportData: ReportData,
  companyName: string,
  format: ExportFormat
): Promise<string> {
  if (format === 'json') {
    return JSON.stringify(reportData, null, 2);
  }
  
  const formatInstructions: Record<ExportFormat, string> = {
    pdf: `Generate a professional HTML document styled for PDF printing with:
- Clean, modern Inter font typography
- Calm Mesh Gradient color scheme: soft pastel pink (#f8b4c4), lavender (#c4b4f8), mint green (#b4e8c4)
- Headers with gradient backgrounds from pink to lavender to mint
- Proper page breaks between major sections
- Tables with soft pastel alternating row colors
- Executive summary at the top with mesh gradient background
- Dark charcoal text (#1a1a2e) for readability
- Border colors using soft lavender (#e8d4f0)
- Use <style> tags with these exact colors for professional CSS styling`,
    
    word: `Generate a clean HTML document suitable for Word conversion with:
- Clear heading hierarchy (h1, h2, h3)
- Calm Mesh Gradient theme with soft pastel colors (pink #f8b4c4, lavender #c4b4f8, mint #b4e8c4)
- Tables with soft lavender borders
- Bullet points for lists
- Dark charcoal text (#1a1a2e)
- Proper paragraph spacing`,
    
    excel: `Generate CSV format with:
- Clear column headers
- One row per data point
- Sections separated by blank rows
- Key-value pairs in two columns where appropriate
- Numerical data in proper format`,
    
    ppt: `Generate HTML formatted for presentation slides with:
- Clear slide breaks (use <hr class="slide-break">)
- Calm Mesh Gradient theme: gradient backgrounds from pink (#f8b4c4) to lavender (#c4b4f8) to mint (#b4e8c4)
- Maximum 5-7 bullet points per slide
- Key metrics highlighted with mint green (#b4e8c4) backgrounds
- Executive summary on first slide with mesh gradient header
- One topic per slide
- Dark charcoal text (#1a1a2e)
- Bold key numbers and statistics`,
    
    json: '',
    txt: '',
    csv: `Generate CSV format with:
- Clear column headers
- One row per data point
- Sections separated by blank rows
- Comma-separated values with proper quoting`,
  };
  
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are an expert business intelligence report formatter. Convert the provided company data into a professional, well-structured report.

REPORT STRUCTURE TO FOLLOW:
${REPORT_STRUCTURE}

FORMAT REQUIREMENTS:
${formatInstructions[format]}

IMPORTANT RULES:
1. Include ALL available data from the input - do not omit any information
2. If data is not available, write "Data not available" or "Not disclosed"
3. Use professional business language
4. Format numbers properly (thousands separators, currency symbols)
5. Highlight key insights and recommendations
6. Include sources and confidence scores at the end`
        },
        {
          role: "user",
          content: `Create a comprehensive business intelligence report for: ${companyName}

DATA TO FORMAT:
${JSON.stringify(reportData, null, 2)}

Generate the full formatted report following the structure provided.`
        }
      ],
      max_completion_tokens: 8000,
      temperature: 0.3,
    });
    
    return response.choices[0]?.message?.content || JSON.stringify(reportData, null, 2);
  } catch (error) {
    console.error("Report formatting error:", error);
    return JSON.stringify(reportData, null, 2);
  }
}

export async function generateCompanyReportHTML(reportData: any, companyName: string): Promise<string> {
  const _d = reportData as any;
  const rd = _d;
  const data = reportData || {};
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${companyName} - Company Intelligence Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #1a1a2e; max-width: 1200px; margin: 0 auto; padding: 20px; background: linear-gradient(135deg, #fdf4f5 0%, #f0f4ff 50%, #f5fdf4 100%); min-height: 100vh; }
    .header { background: linear-gradient(135deg, #f8b4c4 0%, #c4b4f8 50%, #b4e8c4 100%); color: #1a1a2e; padding: 30px; border-radius: 12px; margin-bottom: 30px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
    .header h1 { font-size: 2.5em; margin-bottom: 10px; font-weight: 700; }
    .header .subtitle { opacity: 0.85; font-size: 1.2em; }
    .section { background: rgba(255,255,255,0.9); border: 1px solid rgba(200,180,248,0.3); border-radius: 12px; padding: 25px; margin-bottom: 20px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); backdrop-filter: blur(10px); }
    .section h2 { color: #1a1a2e; border-bottom: 2px solid #e8d4f0; padding-bottom: 10px; margin-bottom: 20px; font-size: 1.5em; }
    .section h3 { color: #6b5b95; margin: 15px 0 10px; font-size: 1.2em; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; }
    .info-card { background: linear-gradient(135deg, #fff5f7 0%, #f5f0ff 100%); padding: 15px; border-radius: 8px; border-left: 4px solid #d4a5c4; }
    .info-card .label { font-size: 0.85em; color: #6b5b95; text-transform: uppercase; letter-spacing: 0.5px; }
    .info-card .value { font-size: 1.1em; color: #1a1a2e; font-weight: 600; margin-top: 5px; }
    .executive-card { background: linear-gradient(135deg, #f0fff4 0%, #f5f0ff 100%); padding: 20px; border-radius: 10px; margin-bottom: 15px; border: 1px solid rgba(180,232,196,0.5); }
    .executive-card h4 { color: #1a1a2e; margin-bottom: 5px; }
    .executive-card .title { color: #6b5b95; font-weight: 500; }
    .executive-card .bio { color: #4a5568; margin-top: 10px; font-size: 0.95em; }
    table { width: 100%; border-collapse: collapse; margin: 15px 0; border-radius: 8px; overflow: hidden; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e8d4f0; }
    th { background: linear-gradient(135deg, #d4a5c4 0%, #a5b4d4 100%); color: #1a1a2e; }
    tr:nth-child(even) { background: rgba(248,180,196,0.1); }
    .metric { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e8d4f0; }
    .metric:last-child { border-bottom: none; }
    .metric .label { color: #6b5b95; }
    .metric .value { font-weight: 600; color: #1a1a2e; }
    .swot-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .swot-box { padding: 20px; border-radius: 10px; }
    .swot-box.strengths { background: linear-gradient(135deg, #d4f5dc 0%, #c4e8d4 100%); border-left: 4px solid #68c88a; }
    .swot-box.weaknesses { background: linear-gradient(135deg, #ffe4e8 0%, #fdd4dc 100%); border-left: 4px solid #e87a8a; }
    .swot-box.opportunities { background: linear-gradient(135deg, #d4e4f8 0%, #c4d4f8 100%); border-left: 4px solid #6898d4; }
    .swot-box.threats { background: linear-gradient(135deg, #fff4d4 0%, #ffe8c4 100%); border-left: 4px solid #d4a868; }
    .swot-box h4 { margin-bottom: 10px; color: #1a1a2e; }
    .swot-box ul { margin-left: 20px; }
    .insight-box { background: linear-gradient(135deg, #f8b4c4 0%, #c4b4f8 50%, #b4e8c4 100%); color: #1a1a2e; padding: 20px; border-radius: 10px; margin: 15px 0; }
    .insight-box h4 { margin-bottom: 10px; }
    .contact-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; }
    .contact-item { display: flex; align-items: center; gap: 10px; padding: 10px; background: rgba(255,255,255,0.7); border-radius: 8px; }
    .contact-item .icon { width: 40px; height: 40px; background: linear-gradient(135deg, #d4a5c4 0%, #a5b4d4 100%); color: #1a1a2e; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
    .sources { background: rgba(255,255,255,0.8); padding: 20px; border-radius: 10px; margin-top: 30px; border: 1px solid rgba(200,180,248,0.3); }
    .sources h3 { margin-bottom: 15px; color: #6b5b95; }
    .source-item { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e8d4f0; }
    @media print { .section { break-inside: avoid; } body { background: white; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>${companyName}</h1>
    <div class="subtitle">${data.profileSummary || 'Company Intelligence Report'}</div>
  </div>

  <div class="section">
    <h2>1. Company Profile</h2>
    <div class="grid">
      <div class="info-card">
        <div class="label">Legal Name</div>
        <div class="value">${data.companyOverview?.legalName || companyName}</div>
      </div>
      <div class="info-card">
        <div class="label">Arabic Name</div>
        <div class="value">${data.companyOverview?.arabicName || 'Not available'}</div>
      </div>
      <div class="info-card">
        <div class="label">Founded</div>
        <div class="value">${data.companyOverview?.founded || 'Not available'}</div>
      </div>
      <div class="info-card">
        <div class="label">Company Type</div>
        <div class="value">${data.companyOverview?.companyType || 'Not available'}</div>
      </div>
      <div class="info-card">
        <div class="label">Headquarters</div>
        <div class="value">${data.companyOverview?.headquarters?.city || ''} ${data.companyOverview?.headquarters?.country || 'Saudi Arabia'}</div>
      </div>
      <div class="info-card">
        <div class="label">Total Employees</div>
        <div class="value">${data.workforce?.totalEmployees || 'Not available'}</div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>2. Ownership & Shareholders</h2>
    <div class="grid">
      <div class="info-card">
        <div class="label">Founders</div>
        <div class="value">${Array.isArray(data.companyOverview?.founders) ? data.companyOverview.founders.join(', ') : 'Not available'}</div>
      </div>
      <div class="info-card">
        <div class="label">Stock Exchange</div>
        <div class="value">${data.companyOverview?.stockInfo?.exchange || 'Private'}</div>
      </div>
      <div class="info-card">
        <div class="label">Ticker</div>
        <div class="value">${data.companyOverview?.stockInfo?.ticker || 'N/A'}</div>
      </div>
      <div class="info-card">
        <div class="label">Market Cap</div>
        <div class="value">${data.companyOverview?.stockInfo?.marketCap || 'Not available'}</div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>3. Leadership & Executives</h2>
    ${data.leadership?.executiveTeam?.map((exec: ExecutiveEntry) => `
      <div class="executive-card">
        <h4>${exec.name || 'Executive'}</h4>
        <div class="title">${exec.title || 'Title not specified'}</div>
        <div class="bio">${exec.background || exec.bio || 'Background information not available'}</div>
        ${exec.linkedin ? `<div style="margin-top:10px"><a href="${exec.linkedin}" target="_blank">LinkedIn Profile</a></div>` : ''}
      </div>
    `).join('') || '<p>Leadership information not available</p>'}
  </div>

  <div class="section">
    <h2>4. Financial Overview</h2>
    <div class="grid">
      <div class="info-card">
        <div class="label">Annual Revenue</div>
        <div class="value">${data.financials?.annualRevenue || 'Not disclosed'}</div>
      </div>
      <div class="info-card">
        <div class="label">Revenue Growth</div>
        <div class="value">${data.financials?.revenueGrowth || 'Not available'}</div>
      </div>
      <div class="info-card">
        <div class="label">Net Income</div>
        <div class="value">${data.financials?.netIncome || 'Not disclosed'}</div>
      </div>
      <div class="info-card">
        <div class="label">Profit Margin</div>
        <div class="value">${data.financials?.profitMargin || 'Not available'}</div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>5. Market Position & Competition</h2>
    <p>${data.companyPositioning || 'Market positioning information not available'}</p>
    
    <h3>Competitive Landscape</h3>
    ${data.competitiveLandscape?.directCompetitors?.length ? `
      <table>
        <thead>
          <tr><th>Competitor</th><th>Comparison</th></tr>
        </thead>
        <tbody>
          ${data.competitiveLandscape.directCompetitors.map((c: Record<string, string>) => `
            <tr><td>${c.name}</td><td>${c.comparison}</td></tr>
          `).join('')}
        </tbody>
      </table>
    ` : '<p>Competitor information not available</p>'}
  </div>

  <div class="section">
    <h2>6. SWOT Analysis</h2>
    <div class="swot-grid">
      <div class="swot-box strengths">
        <h4>Strengths</h4>
        <ul>${data.swotAnalysis?.strengths?.map((s: string) => `<li>${s}</li>`).join('') || '<li>Not available</li>'}</ul>
      </div>
      <div class="swot-box weaknesses">
        <h4>Weaknesses</h4>
        <ul>${data.swotAnalysis?.weaknesses?.map((w: string) => `<li>${w}</li>`).join('') || '<li>Not available</li>'}</ul>
      </div>
      <div class="swot-box opportunities">
        <h4>Opportunities</h4>
        <ul>${data.swotAnalysis?.opportunities?.map((o: string) => `<li>${o}</li>`).join('') || '<li>Not available</li>'}</ul>
      </div>
      <div class="swot-box threats">
        <h4>Threats</h4>
        <ul>${data.swotAnalysis?.threats?.map((t: string) => `<li>${t}</li>`).join('') || '<li>Not available</li>'}</ul>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>7. AI Insights & Recommendations</h2>
    <div class="insight-box">
      <h4>Investment Outlook</h4>
      <p>${data.aiAnalysis?.investmentOutlook || 'Analysis not available'}</p>
    </div>
    <h3>Key Insights</h3>
    <ul>
      ${_d.keyInsights?.map((i: string) => `<li>${i}</li>`).join('') || '<li>No insights available</li>'}
    </ul>
    <h3>Strategic Recommendations</h3>
    <ul>
      ${data.recommendations?.map((r: string) => `<li>${r}</li>`).join('') || 
        data.aiAnalysis?.strategicRecommendations?.map((r: string) => `<li>${r}</li>`).join('') || 
        '<li>No recommendations available</li>'}
    </ul>
  </div>

  <div class="section">
    <h2>8. Contact Information</h2>
    <div class="contact-grid">
      <div class="contact-item">
        <div class="icon">📞</div>
        <div>
          <div class="label">Phone</div>
          <div>${data.contactInfo?.generalPhone || 'Not available'}</div>
        </div>
      </div>
      <div class="contact-item">
        <div class="icon">✉️</div>
        <div>
          <div class="label">Email</div>
          <div>${data.contactInfo?.email || 'Not available'}</div>
        </div>
      </div>
      <div class="contact-item">
        <div class="icon">🌐</div>
        <div>
          <div class="label">Website</div>
          <div>${data.contactInfo?.website || 'Not available'}</div>
        </div>
      </div>
      <div class="contact-item">
        <div class="icon">💼</div>
        <div>
          <div class="label">LinkedIn</div>
          <div>${data.socialMedia?.linkedin?.url || 'Not available'}</div>
        </div>
      </div>
    </div>
  </div>

  <div class="sources">
    <h3>Data Sources</h3>
    <p>This report was compiled from multiple verified sources including Apollo.io, Explorium, company website crawling, and AI analysis.</p>
  </div>
</body>
</html>`;
}

export async function generatePersonReportHTML(reportData: any, personName: string): Promise<string> {
  const _d = reportData as any;
  const rd = _d;
  const data = reportData || {};
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${personName} - Executive Intelligence Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #1a1a2e; max-width: 1200px; margin: 0 auto; padding: 20px; background: linear-gradient(135deg, #fdf4f5 0%, #f0f4ff 50%, #f5fdf4 100%); min-height: 100vh; }
    .header { background: linear-gradient(135deg, #c4b4f8 0%, #f8b4c4 50%, #b4e8c4 100%); color: #1a1a2e; padding: 30px; border-radius: 12px; margin-bottom: 30px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
    .header h1 { font-size: 2.5em; margin-bottom: 10px; font-weight: 700; }
    .header .subtitle { opacity: 0.85; font-size: 1.2em; }
    .section { background: rgba(255,255,255,0.9); border: 1px solid rgba(200,180,248,0.3); border-radius: 12px; padding: 25px; margin-bottom: 20px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); backdrop-filter: blur(10px); }
    .section h2 { color: #1a1a2e; border-bottom: 2px solid #e8d4f0; padding-bottom: 10px; margin-bottom: 20px; font-size: 1.5em; }
    .section h3 { color: #6b5b95; margin: 15px 0 10px; font-size: 1.2em; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; }
    .info-card { background: linear-gradient(135deg, #f5f0ff 0%, #fff5f7 100%); padding: 15px; border-radius: 8px; border-left: 4px solid #c4b4f8; }
    .info-card .label { font-size: 0.85em; color: #6b5b95; text-transform: uppercase; letter-spacing: 0.5px; }
    .info-card .value { font-size: 1.1em; color: #1a1a2e; font-weight: 600; margin-top: 5px; }
    .experience-card { background: linear-gradient(135deg, #f0fff4 0%, #f5f0ff 100%); padding: 20px; border-radius: 10px; margin-bottom: 15px; border-left: 4px solid #b4e8c4; }
    .experience-card h4 { color: #1a1a2e; margin-bottom: 5px; }
    .experience-card .company { color: #6b5b95; font-weight: 500; }
    .experience-card .duration { color: #718096; font-size: 0.9em; }
    .experience-card .description { color: #4a5568; margin-top: 10px; font-size: 0.95em; }
    .skills-container { display: flex; flex-wrap: wrap; gap: 10px; }
    .skill-tag { background: linear-gradient(135deg, #c4b4f8 0%, #d4a5c4 100%); color: #1a1a2e; padding: 6px 12px; border-radius: 20px; font-size: 0.9em; font-weight: 500; }
    .education-card { background: linear-gradient(135deg, #f0fff4 0%, #d4f5dc 100%); padding: 15px; border-radius: 8px; margin-bottom: 10px; border-left: 4px solid #68c88a; }
    .contact-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; }
    .contact-item { display: flex; align-items: center; gap: 10px; padding: 10px; background: rgba(255,255,255,0.7); border-radius: 8px; }
    .insight-box { background: linear-gradient(135deg, #f8b4c4 0%, #c4b4f8 50%, #b4e8c4 100%); color: #1a1a2e; padding: 20px; border-radius: 10px; margin: 15px 0; }
    .insight-box h4 { margin-bottom: 10px; }
    ul { margin-left: 20px; margin-top: 10px; }
    li { margin-bottom: 8px; }
    .sources { background: rgba(255,255,255,0.8); padding: 20px; border-radius: 10px; margin-top: 30px; border: 1px solid rgba(200,180,248,0.3); }
    @media print { .section { break-inside: avoid; } body { background: white; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>${personName}</h1>
    <div class="subtitle">${data.currentRole?.title || ''} ${data.currentRole?.company ? 'at ' + data.currentRole.company : ''}</div>
  </div>

  <div class="section">
    <h2>1. Executive Summary</h2>
    <p>${data.profileSummary || 'No summary available.'}</p>
  </div>

  <div class="section">
    <h2>2. Current Role</h2>
    <div class="grid">
      <div class="info-card">
        <div class="label">Title</div>
        <div class="value">${data.currentRole?.title || 'Not available'}</div>
      </div>
      <div class="info-card">
        <div class="label">Company</div>
        <div class="value">${data.currentRole?.company || 'Not available'}</div>
      </div>
      <div class="info-card">
        <div class="label">Department</div>
        <div class="value">${data.currentRole?.department || 'Not available'}</div>
      </div>
      <div class="info-card">
        <div class="label">Start Date</div>
        <div class="value">${data.currentRole?.startDate || 'Not available'}</div>
      </div>
    </div>
    ${data.currentRole?.responsibilities ? `
    <h3>Key Responsibilities</h3>
    <ul>
      ${data.currentRole.responsibilities.map((r: string) => `<li>${r}</li>`).join('')}
    </ul>
    ` : ''}
  </div>

  <div class="section">
    <h2>3. Compensation & Experience</h2>
    <div class="grid">
      <div class="info-card">
        <div class="label">Estimated Compensation</div>
        <div class="value">${data.estimatedAnnualIncome || data.estimatedCompensation || 'Not available'}</div>
      </div>
      <div class="info-card">
        <div class="label">Years of Experience</div>
        <div class="value">${data.yearsOfExperience || 'Not available'}</div>
      </div>
      <div class="info-card">
        <div class="label">Company Positioning</div>
        <div class="value">${data.companyPositioning || 'Not available'}</div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>4. Career History</h2>
    ${data.careerHistory?.length ? data.careerHistory.map((exp: Record<string, string>) => `
      <div class="experience-card">
        <h4>${exp.title || 'Unknown Role'}</h4>
        <div class="company">${exp.company || 'Unknown Company'}</div>
        <div class="duration">${exp.duration || ''} ${exp.location ? '- ' + exp.location : ''}</div>
        ${exp.description ? `<div class="description">${exp.description}</div>` : ''}
      </div>
    `).join('') : data.experience?.length ? data.experience.map((exp: Record<string, string>) => `
      <div class="experience-card">
        <h4>${exp.title || 'Unknown Role'}</h4>
        <div class="company">${exp.company || 'Unknown Company'}</div>
        <div class="duration">${exp.duration || ''} ${exp.location ? '- ' + exp.location : ''}</div>
        ${exp.description ? `<div class="description">${exp.description}</div>` : ''}
      </div>
    `).join('') : '<p>No career history available.</p>'}
  </div>

  <div class="section">
    <h2>5. Education</h2>
    ${data.education?.length ? data.education.map((edu: Record<string, string>) => `
      <div class="education-card">
        <strong>${edu.degree || 'Degree'}</strong> ${edu.field ? 'in ' + edu.field : ''}<br>
        ${edu.institution || 'Unknown Institution'} ${edu.year ? '(' + edu.year + ')' : ''}
        ${edu.honors ? '<br><em>' + edu.honors + '</em>' : ''}
      </div>
    `).join('') : '<p>No education information available.</p>'}
  </div>

  <div class="section">
    <h2>6. Skills & Expertise</h2>
    <div class="skills-container">
      ${Array.isArray(data.skills) ? data.skills.map((skill: string) => `<span class="skill-tag">${skill}</span>`).join('') : ''}
      ${data.skills?.technical ? data.skills.technical.map((s: string) => `<span class="skill-tag">${s}</span>`).join('') : ''}
      ${data.skills?.leadership ? data.skills.leadership.map((s: string) => `<span class="skill-tag">${s}</span>`).join('') : ''}
      ${data.skills?.industry ? data.skills.industry.map((s: string) => `<span class="skill-tag">${s}</span>`).join('') : ''}
    </div>
  </div>

  ${_d.boardPositions?.length > 0 ? `
  <div class="section">
    <h2>7. Board Positions</h2>
    ${_d.boardPositions.map((pos: Record<string, string>) => `
      <div class="info-card" style="margin-bottom: 10px;">
        <div class="label">${pos.organization || 'Organization'}</div>
        <div class="value">${pos.role || 'Board Member'} ${pos.since ? '(since ' + pos.since + ')' : ''}</div>
      </div>
    `).join('')}
  </div>
  ` : ''}

  ${_d.awards?.length > 0 || _d.certifications?.length > 0 ? `
  <div class="section">
    <h2>8. Awards & Certifications</h2>
    ${_d.awards?.length > 0 ? `
      <h3>Awards</h3>
      <ul>
        ${_d.awards.map((a: string) => `<li>${a}</li>`).join('')}
      </ul>
    ` : ''}
    ${_d.certifications?.length > 0 ? `
      <h3>Certifications</h3>
      <ul>
        ${_d.certifications.map((c: string) => `<li>${c}</li>`).join('')}
      </ul>
    ` : ''}
  </div>
  ` : ''}

  <div class="section">
    <h2>9. Contact Information</h2>
    <div class="contact-grid">
      ${data.contactInfo?.email || data.socialProfiles?.email ? `
        <div class="contact-item">
          <strong>Email:</strong> ${data.contactInfo?.email || data.socialProfiles?.email}
        </div>
      ` : ''}
      ${data.contactInfo?.phone || data.socialProfiles?.phone ? `
        <div class="contact-item">
          <strong>Phone:</strong> ${data.contactInfo?.phone || data.socialProfiles?.phone}
        </div>
      ` : ''}
      ${data.socialProfiles?.linkedin ? `
        <div class="contact-item">
          <strong>LinkedIn:</strong> ${data.socialProfiles.linkedin}
        </div>
      ` : ''}
      ${data.socialProfiles?.twitter ? `
        <div class="contact-item">
          <strong>Twitter:</strong> ${data.socialProfiles.twitter}
        </div>
      ` : ''}
    </div>
  </div>

  ${_d.keyInsights?.length > 0 ? `
  <div class="insight-box">
    <h4>Key Insights</h4>
    <ul>
      ${_d.keyInsights.map((i: string) => `<li>${i}</li>`).join('')}
    </ul>
  </div>
  ` : ''}

  ${data.recommendations?.length > 0 || data.engagementRecommendations?.length > 0 ? `
  <div class="section">
    <h2>10. Engagement Recommendations</h2>
    <ul>
      ${(data.engagementRecommendations || data.recommendations || []).map((r: string) => `<li>${r}</li>`).join('')}
    </ul>
  </div>
  ` : ''}

  <div class="sources">
    <h3>Data Sources</h3>
    <p>This report was compiled from multiple verified sources including Apollo.io, LinkedIn profile data, and AI analysis.</p>
  </div>
</body>
</html>`;
}

export interface ProspectingCompanyExport {
  name: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  city?: string;
  industry?: string;
  description?: string;
  contactPerson?: string;
  enrichmentStatus?: string;
  crNumber?: string;
  capital?: string;
  entityType?: string;
  registrationDate?: string;
  founded?: string;
  employees?: string;
  revenue?: string;
  keyPeople?: string;
  services?: string;
  ownerName?: string;
  shareholders?: string;
  landline?: string;
  location?: string;
  marketPositioning?: string;
}

export interface ProspectingEnrichmentData {
  subjectName: string;
  confidenceScore?: string | null;
  profileSummary?: string;
  financials?: {
    annualRevenue?: string;
    revenueGrowth?: string;
    netIncome?: string;
    profitMargin?: string;
    totalAssets?: string;
  };
  workforce?: {
    totalEmployees?: string;
    employeeGrowth?: string;
    saudiNationalsPercentage?: string;
  };
  companyOverview?: {
    founded?: string;
    headquarters?: { city?: string; country?: string };
    companyType?: string;
  };
  leadership?: {
    executiveTeam?: Array<{ name?: string; title?: string; department?: string; background?: string }>;
    boardOfDirectors?: Array<{ name?: string; title?: string; background?: string }>;
  };
  strengths?: string[];
  keyInsights?: string[];
}

export interface ProspectingExportInput {
  targetUrl: string;
  totalCompanies: number;
  totalEnriched: number;
  pagesScanned: number;
  companies: ProspectingCompanyExport[];
  enrichmentData: ProspectingEnrichmentData[];
}

export function exportProspectingToCSV(input: ProspectingExportInput): ExportResult {
  const headers = ['Name', 'Phone', 'Email', 'Website', 'Address', 'City', 'Industry', 'Description', 'Contact Person', 'CR Number', 'Capital', 'Entity Type', 'Registration Date', 'Founded', 'Employees', 'Revenue', 'Owner Name', 'Shareholders', 'Landline', 'Location', 'Market Positioning', 'Key People', 'Services', 'Enrichment'];
  const rows = input.companies.map(c => [
    c.name, c.phone || '', c.email || '', c.website || '', c.address || '', c.city || '', c.industry || '', (c.description || '').replace(/,/g, ';'), c.contactPerson || '', c.crNumber || '', c.capital || '', c.entityType || '', c.registrationDate || '', c.founded || '', c.employees || '', c.revenue || '', c.ownerName || '', (c.shareholders || '').replace(/,/g, ';'), c.landline || '', c.location || '', (c.marketPositioning || '').replace(/,/g, ';'), (c.keyPeople || '').replace(/,/g, ';'), (c.services || '').replace(/,/g, ';'), c.enrichmentStatus || 'pending',
  ].map(v => `"${v}"`).join(','));
  const domain = new URL(input.targetUrl).hostname.replace('www.', '');
  const ts = new Date().toISOString().split('T')[0];
  const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n');
  return {
    format: 'csv',
    content: csvContent,
    filename: `Prospecting_${domain}_${ts}.csv`,
    mimeType: 'text/csv; charset=utf-8',
  };
}

export function exportProspectingToJSON(input: ProspectingExportInput): ExportResult {
  const domain = new URL(input.targetUrl).hostname.replace('www.', '');
  const ts = new Date().toISOString().split('T')[0];
  return {
    format: 'json',
    content: JSON.stringify({ job: { url: input.targetUrl, totalCompanies: input.totalCompanies, generatedAt: new Date().toISOString() }, companies: input.companies, enrichment: input.enrichmentData }, null, 2),
    filename: `Prospecting_${domain}_${ts}.json`,
    mimeType: 'application/json',
  };
}

export function exportProspectingToExcel(input: ProspectingExportInput): ExportResult {
  const workbook = XLSX.utils.book_new();
  const domain = new URL(input.targetUrl).hostname.replace('www.', '');
  const ts = new Date().toISOString().split('T')[0];

  const summarySheet = XLSX.utils.json_to_sheet([{
    "Source URL": input.targetUrl,
    "Total Companies": input.totalCompanies,
    "Enriched": input.totalEnriched,
    "Pages Scanned": input.pagesScanned,
    "Generated": new Date().toLocaleString(),
  }]);
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");

  const companyRows = input.companies.map((c, idx) => ({
    "#": idx + 1,
    "Company Name": c.name,
    "Industry": c.industry || '',
    "City": c.city || '',
    "Website": c.website || '',
    "CR Number": c.crNumber || '',
    "Capital": c.capital || '',
    "Entity Type": c.entityType || '',
    "Registration Date": c.registrationDate || '',
    "Founded": c.founded || '',
    "Employees": c.employees || '',
    "Revenue": c.revenue || '',
    "Owner Name": c.ownerName || '',
    "Shareholders": c.shareholders || '',
    "Landline": c.landline || '',
    "Location": c.location || '',
    "Market Positioning": c.marketPositioning || '',
    "Key People": c.keyPeople || '',
    "Services": c.services || '',
    "Description": c.description || '',
    "Enrichment": c.enrichmentStatus || 'pending',
  }));
  const companySheet = XLSX.utils.json_to_sheet(companyRows);
  const companyHeaders = Object.keys(companyRows[0] || {});
  companySheet['!cols'] = companyHeaders.map(h => {
    let maxLen = h.length;
    companyRows.forEach(row => {
      const val = String((row as Record<string, string | number>)[h] || '');
      maxLen = Math.max(maxLen, Math.min(val.length, 60));
    });
    return { wch: maxLen + 2 };
  });

  const enrichmentColIdx = companyHeaders.indexOf("Enrichment");
  if (enrichmentColIdx >= 0) {
    const enrichmentStatusColors: Record<string, { rgb: string }> = {
      enriched: { rgb: "C6EFCE" },
      completed: { rgb: "C6EFCE" },
      pending: { rgb: "D9D9D9" },
      failed: { rgb: "FFC7CE" },
    };
    for (let row = 0; row < companyRows.length; row++) {
      const cellRef = XLSX.utils.encode_cell({ r: row + 1, c: enrichmentColIdx });
      const cell = companySheet[cellRef];
      if (cell) {
        const status = String(cell.v || '').toLowerCase();
        const colorEntry = enrichmentStatusColors[status];
        if (colorEntry) {
          cell.s = { fill: { fgColor: colorEntry } };
        }
      }
    }
  }

  XLSX.utils.book_append_sheet(workbook, companySheet, "Companies");

  const contactRows = input.companies
    .filter(c => c.email || c.phone || c.contactPerson)
    .map(c => ({
      "Company Name": c.name,
      "Contact Person": c.contactPerson || '',
      "Email": c.email || '',
      "Phone": c.phone || '',
      "Address": c.address || '',
      "City": c.city || '',
    }));
  if (contactRows.length > 0) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(contactRows), "Contacts");
  }

  const execRows: Record<string, string>[] = [];
  for (const enriched of input.enrichmentData) {
    for (const exec of (enriched.leadership?.executiveTeam || [])) {
      execRows.push({
        "Company": enriched.subjectName,
        "Name": exec.name || '',
        "Title": exec.title || '',
        "Department": exec.department || '',
        "Background": exec.background || '',
      });
    }
    for (const dir of (enriched.leadership?.boardOfDirectors || [])) {
      execRows.push({
        "Company": enriched.subjectName,
        "Name": dir.name || '',
        "Title": dir.title || 'Board Member',
        "Department": 'Board',
        "Background": dir.background || '',
      });
    }
  }
  if (execRows.length > 0) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(execRows), "Executives");
  }

  const finRows: Record<string, string>[] = [];
  for (const enriched of input.enrichmentData) {
    if (enriched.financials) {
      finRows.push({
        "Company": enriched.subjectName,
        "Annual Revenue": enriched.financials.annualRevenue || '',
        "Revenue Growth": enriched.financials.revenueGrowth || '',
        "Net Income": enriched.financials.netIncome || '',
        "Profit Margin": enriched.financials.profitMargin || '',
        "Total Assets": enriched.financials.totalAssets || '',
        "Total Employees": enriched.workforce?.totalEmployees || '',
        "Employee Growth": enriched.workforce?.employeeGrowth || '',
        "Saudization %": enriched.workforce?.saudiNationalsPercentage || '',
        "Founded": enriched.companyOverview?.founded || '',
        "Company Type": enriched.companyOverview?.companyType || '',
      });
    }
  }
  if (finRows.length > 0) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(finRows), "Financials");
  }

  const citySummary: Record<string, number> = {};
  const industrySummary: Record<string, number> = {};
  for (const c of input.companies) {
    if (c.city) citySummary[c.city] = (citySummary[c.city] || 0) + 1;
    if (c.industry) industrySummary[c.industry] = (industrySummary[c.industry] || 0) + 1;
  }
  const breakdownRows = [
    ...Object.entries(citySummary).map(([k, v]) => ({ "Category": "City", "Value": k, "Count": v })),
    ...Object.entries(industrySummary).map(([k, v]) => ({ "Category": "Industry", "Value": k, "Count": v })),
  ];
  if (breakdownRows.length > 0) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(breakdownRows), "Breakdown");
  }

  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'base64' });
  return {
    format: 'excel',
    content: buffer,
    filename: `Prospecting_${domain}_${ts}.xlsx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}

export async function exportProspectingToPDF(input: ProspectingExportInput): Promise<ExportResult> {
  const domain = new URL(input.targetUrl).hostname.replace('www.', '');
  const ts = new Date().toISOString().split('T')[0];

  const citySummary: Record<string, number> = {};
  const industrySummary: Record<string, number> = {};
  for (const c of input.companies) {
    if (c.city) citySummary[c.city] = (citySummary[c.city] || 0) + 1;
    if (c.industry) industrySummary[c.industry] = (industrySummary[c.industry] || 0) + 1;
  }

  const companySample = input.companies.slice(0, 30).map(c =>
    `${c.name} | ${c.industry || '-'} | ${c.city || '-'} | ${c.phone || '-'} | ${c.email || '-'}`
  ).join('\n');

  const enrichmentSample = input.enrichmentData.slice(0, 5).map(e =>
    `${e.subjectName}: ${e.profileSummary?.substring(0, 200) || 'No summary'}`
  ).join('\n');

  let aiAnalysis = '';
  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{
        role: "user",
        content: `Generate a structured HTML report body for a prospecting intelligence report.

Source: ${input.targetUrl}
Total Companies: ${input.totalCompanies}
Cities: ${JSON.stringify(citySummary)}
Industries: ${JSON.stringify(industrySummary)}
Enriched: ${input.totalEnriched}
Pages Scanned: ${input.pagesScanned}

Sample companies (first 30):
${companySample}

Enrichment highlights:
${enrichmentSample || 'None'}

Return ONLY the HTML body content (no <html>, <head>, <body> tags). Include:
1. Executive Summary paragraph analyzing the prospected data landscape
2. Market Analysis section with insights on industry/city distribution
3. Key Findings section highlighting notable companies and patterns
4. Recommendations section for sales/outreach strategy

Use <h2>, <p>, <ul>, <li> tags. Keep it professional and data-driven. Max 800 words.`,
      }],
      max_tokens: 2000,
      temperature: 0.4,
    });
    aiAnalysis = resp.choices[0]?.message?.content || '';
    if (aiAnalysis.includes('```html')) {
      aiAnalysis = aiAnalysis.replace(/```html\n?/g, '').replace(/```\n?/g, '');
    }
  } catch {
    aiAnalysis = `<h2>Executive Summary</h2><p>Prospecting scan of ${domain} yielded ${input.totalCompanies} companies across ${Object.keys(citySummary).length} cities and ${Object.keys(industrySummary).length} industries.</p>`;
  }

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Prospecting Report - ${domain}</title>
<style>
  body { font-family: 'Inter', Arial, sans-serif; margin: 40px; color: #1a1a2e; }
  h1 { color: #0a2463; border-bottom: 3px solid #3e92cc; padding-bottom: 10px; }
  h2 { color: #0a2463; margin-top: 30px; border-bottom: 1px solid #ddd; padding-bottom: 5px; }
  .summary { display: flex; gap: 20px; margin: 20px 0; flex-wrap: wrap; }
  .stat { background: #f0f4ff; padding: 15px 25px; border-radius: 8px; text-align: center; min-width: 120px; }
  .stat-value { font-size: 28px; font-weight: bold; color: #0a2463; }
  .stat-label { font-size: 12px; color: #666; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 13px; }
  th { background: #0a2463; color: white; padding: 10px 12px; text-align: left; }
  td { padding: 8px 12px; border-bottom: 1px solid #eee; }
  tr:nth-child(even) { background: #f8f9ff; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; margin: 1px; }
  .badge-city { background: #e0f2fe; color: #0369a1; }
  .badge-industry { background: #f0fdf4; color: #15803d; }
  .ai-section { background: #fafbff; border-left: 4px solid #3e92cc; padding: 20px; margin: 20px 0; border-radius: 0 8px 8px 0; }
  .footer { margin-top: 40px; padding-top: 15px; border-top: 1px solid #ddd; color: #999; font-size: 11px; }
  @media print { body { margin: 20px; } }
</style></head><body>
<h1>Smart Prospecting Report</h1>
<p><strong>Source:</strong> ${input.targetUrl}</p>
<p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>

<div class="summary">
  <div class="stat"><div class="stat-value">${input.totalCompanies}</div><div class="stat-label">Companies</div></div>
  <div class="stat"><div class="stat-value">${Object.keys(citySummary).length}</div><div class="stat-label">Cities</div></div>
  <div class="stat"><div class="stat-value">${Object.keys(industrySummary).length}</div><div class="stat-label">Industries</div></div>
  <div class="stat"><div class="stat-value">${input.totalEnriched}</div><div class="stat-label">Enriched</div></div>
  <div class="stat"><div class="stat-value">${input.pagesScanned}</div><div class="stat-label">Pages Scanned</div></div>
</div>

<div class="ai-section">
${aiAnalysis}
</div>

${Object.keys(citySummary).length > 0 ? `<h2>Distribution by City</h2><p>${Object.entries(citySummary).map(([c, n]) => `<span class="badge badge-city">${c} (${n})</span>`).join(' ')}</p>` : ''}
${Object.keys(industrySummary).length > 0 ? `<h2>Distribution by Industry</h2><p>${Object.entries(industrySummary).map(([ind, n]) => `<span class="badge badge-industry">${ind} (${n})</span>`).join(' ')}</p>` : ''}

<h2>Companies</h2>
<table>
<thead><tr><th>#</th><th>Company</th><th>Industry</th><th>City</th><th>Phone</th><th>Email</th><th>Website</th><th>Contact</th></tr></thead>
<tbody>
${input.companies.map((c, i) => `<tr><td>${i + 1}</td><td>${c.name}</td><td>${c.industry || '-'}</td><td>${c.city || '-'}</td><td>${c.phone || '-'}</td><td>${c.email || '-'}</td><td>${c.website || '-'}</td><td>${c.contactPerson || '-'}</td></tr>`).join('\n')}
</tbody>
</table>

${input.enrichmentData.length > 0 ? `
<h2>AI Enrichment Analysis</h2>
${input.enrichmentData.map(e => `
<div style="margin: 20px 0; padding: 15px; border: 1px solid #e5e7eb; border-radius: 8px;">
  <h3 style="color: #0a2463; margin-top: 0;">${e.subjectName}</h3>
  <p>${e.profileSummary || ''}</p>
  ${e.financials?.annualRevenue ? `<p><strong>Revenue:</strong> ${e.financials.annualRevenue} | <strong>Growth:</strong> ${e.financials.revenueGrowth || 'N/A'}</p>` : ''}
  ${e.workforce?.totalEmployees ? `<p><strong>Employees:</strong> ${e.workforce.totalEmployees}</p>` : ''}
  ${(e.leadership?.executiveTeam || []).length > 0 ? `<p><strong>Key Executives:</strong> ${e.leadership!.executiveTeam!.map(ex => `${ex.name || ''} (${ex.title || ''})`).join(', ')}</p>` : ''}
  ${(e.strengths || []).length > 0 ? `<p><strong>Strengths:</strong> ${e.strengths!.join('; ')}</p>` : ''}
</div>
`).join('')}
` : ''}

<h2>Contact Directory</h2>
<table>
<thead><tr><th>Company</th><th>Contact Person</th><th>Email</th><th>Phone</th><th>Address</th></tr></thead>
<tbody>
${input.companies.filter(c => c.email || c.phone || c.contactPerson).map(c => `<tr><td>${c.name}</td><td>${c.contactPerson || '-'}</td><td>${c.email || '-'}</td><td>${c.phone || '-'}</td><td>${c.address || '-'}</td></tr>`).join('\n')}
</tbody>
</table>

<div class="footer">Generated by ORQESTRA Smart Prospecting Engine</div>
</body></html>`;

  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const pdfBuffer = await page.pdf({
      format: "A4",
      margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
      printBackground: true,
    });
    await browser.close();

    return {
      format: 'pdf',
      content: Buffer.from(pdfBuffer).toString('base64'),
      filename: `Prospecting_${domain}_${ts}.pdf`,
      mimeType: 'application/pdf',
    };
  } catch (err) {
    console.error(`[Export] PDF generation via Playwright failed: ${(err as Error).message}`);
    throw new Error("PDF generation failed. Playwright could not render the document.");
  }
}
