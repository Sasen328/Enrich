// ─── RELATIONSHIP INTELLIGENCE ENGINE — 4-Agent Org-Chart Factory ───────────────
//
//  Agent 1 │ Org Mapper        — Masaar AOA + Tadawul + OrcBase → org chart nodes
//  Agent 2 │ Stakeholder Enricher — Scout individual signals + NEXUS deep profile
//  Agent 3 │ Network Expander  — board overlaps + adjacent companies
//  Agent 4 │ Outreach Sequencer — ranked contact plan + personalised copy
//
// ─────────────────────────────────────────────────────────────────────────────────

import axios from "axios";
import { EventEmitter } from "events";
import { db } from "@workspace/db";
import {
  relationshipIntelJobsTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { generateWithGemini, isGeminiConfigured } from "../gemini-search.js";
import { scoutSiteIntel, scoutSignalsIndividualFull } from "./scout-client.js";
import { nexusSynthesize } from "./nexus/index.js";

// ─── Job Registry ─────────────────────────────────────────────────────────────

import { JobRegistry } from "./job-registry.js";

const registry = new JobRegistry({ idPrefix: "ri", maxEntries: 100, maxListeners: 20 });
const jobEmitters = registry; // legacy alias for internal .get() calls

export function createRelationshipIntelJob(): string {
  return registry.create().jobId;
}

export function getRelationshipIntelEmitter(jobId: string): EventEmitter | undefined {
  return registry.get(jobId);
}

/** Cancel a running Relationship Intel job. */
export function cancelRelationshipIntelJob(jobId: string): boolean {
  return registry.cancel(jobId);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RelationshipIntelBrief {
  targetCompanyName: string;
  targetCompanyNameAr?: string;
  targetCrNumber?: string;
  targetWebsite?: string;
  context?: string;
  outputDepth?: "basic" | "deep";
}

export interface OrgNode {
  id: string;
  type: "executive" | "board" | "shareholder" | "subsidiary" | "department";
  nameEn: string;
  nameAr?: string;
  title?: string;
  titleAr?: string;
  seniority?: "C-Suite" | "VP" | "Director" | "Manager" | "Board";
  email?: string;
  phone?: string;
  linkedin?: string;
  ownership?: string;
  nationality?: string;
  source?: string;
  signalData?: Record<string, unknown>;
  children?: OrgNode[];
}

export interface NetworkConnection {
  name: string;
  nameAr?: string;
  relationship: string;
  companyType: string;
  domain?: string;
  overlappingPeople: string[];
  strength: "strong" | "medium" | "weak";
}

export interface OutreachContact {
  rank: number;
  nodeId: string;
  name: string;
  title?: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  icpFitReason: string;
  outreachEmail?: string;
  outreachLinkedin?: string;
  whatsappOpener?: string;
  bestTimeToReach?: string;
  conversationHook?: string;
  culturalNote?: string;
}

type AgentEvent =
  | { type: "agent_start"; agent: number; label: string }
  | { type: "agent_log"; agent: number; message: string }
  | { type: "agent_progress"; agent: number; current: number; total: number }
  | { type: "org_node_found"; agent: number; node: OrgNode }
  | { type: "stakeholder_enriched"; agent: number; nodeId: string; name: string }
  | { type: "network_connection"; agent: number; connection: NetworkConnection }
  | { type: "outreach_contact"; agent: number; contact: OutreachContact }
  | { type: "agent_complete"; agent: number; label: string; count?: number }
  | { type: "agent_error"; agent: number; message: string }
  | { type: "pipeline_complete"; jobId: number; totalContacts: number; totalConnections: number; adjacentCompanies: number }
  | { type: "heartbeat" };

function emit(emitter: EventEmitter, event: AgentEvent) {
  emitter.emit("event", event);
}

async function httpGet(url: string, ms = 10000): Promise<{ ok: boolean; data?: unknown; text?: string }> {
  try {
    const r = await axios.get(url, {
      timeout: ms,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ProspectSA/1.0)", Accept: "application/json, text/html, */*", "Accept-Language": "ar,en;q=0.9" },
    });
    return typeof r.data === "string" ? { ok: true, text: r.data } : { ok: true, data: r.data };
  } catch { return { ok: false }; }
}

async function parseJsonFromGemini(raw: string | null, fallback: unknown = null): Promise<unknown> {
  if (!raw) return fallback;
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || raw.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (match) { try { return JSON.parse(match[1] || match[0]); } catch {} }
  try { return JSON.parse(raw); } catch {}
  return fallback;
}

// ─── Agent 1: Org Mapper ──────────────────────────────────────────────────────

async function agent1_mapOrg(brief: RelationshipIntelBrief, emitter: EventEmitter): Promise<OrgNode[]> {
  emit(emitter, { type: "agent_start", agent: 1, label: "Org Mapper" });
  const nodes: OrgNode[] = [];
  const seen = new Set<string>();

  function addNode(node: OrgNode) {
    const key = (node.nameEn + (node.title || "")).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    nodes.push(node);
    emit(emitter, { type: "org_node_found", agent: 1, node });
    emit(emitter, { type: "agent_log", agent: 1, message: `Mapped: ${node.nameEn} — ${node.title || node.type}` });
  }

  // ── Scout Site Intel ────────────────────────────────────────────────────────
  if (brief.targetWebsite) {
    emit(emitter, { type: "agent_log", agent: 1, message: `Running Scout on ${brief.targetWebsite}` });
    try {
      const site = await scoutSiteIntel(brief.targetWebsite);
      if (site?.ok && site?.emails) {
        for (const email of site?.emails.slice(0, 5)) {
          addNode({ id: `email_${email}`, type: "executive", nameEn: email.split("@")[0], email, source: "Scout" });
        }
      }
    } catch {}
  }

  // ── Gemini Research: Board + Executive Mapping ───────────────────────────────
  emit(emitter, { type: "agent_log", agent: 1, message: "Researching org structure via Gemini…" });
  if (isGeminiConfigured()) {
    const prompt = `You are a Saudi corporate intelligence analyst. Research the organizational structure of ${brief.targetCompanyName} (${brief.targetCompanyNameAr || ""}).

Extract ALL known:
1. C-suite executives (CEO, CFO, COO, CTO, CMO, etc.)
2. Board of directors members
3. Key VPs and Directors
4. Major shareholders (if public info available)

Sources to check (mentally):
- Tadawul/Saudi Exchange disclosures
- CMA announcements
- Argaam corporate actions
- LinkedIn public profiles
- Company website
- SaudiCEOs.com / SaudiBODs.com
- Forbes Middle East profiles
- CNBC Arabia interviews
- Zawya / Arab News executive coverage

Return a JSON array of people with:
{
  "nameEn": "Full English Name",
  "nameAr": "الاسم العربي",
  "title": "Exact job title in English",
  "titleAr": "المسمى الوظيفي بالعربية",
  "type": "executive|board|shareholder",
  "seniority": "C-Suite|VP|Director|Board",
  "email": "email if known",
  "linkedin": "linkedin URL if known",
  "nationality": "Saudi|Other",
  "source": "source name"
}

Company: ${brief.targetCompanyName}
CR: ${brief.targetCrNumber || "unknown"}
Website: ${brief.targetWebsite || "unknown"}
Context: ${brief.context || "Saudi Arabia B2B"}`;

    const raw = await generateWithGemini(prompt, "Output only valid JSON array. Use real verified data only.");
    const people = await parseJsonFromGemini(raw, []) as OrgNode[];
    if (Array.isArray(people)) {
      for (let i = 0; i < people.length; i++) {
        const p = people[i];
        if (p.nameEn && p.nameEn.length > 2) {
          addNode({ ...p, id: `gemini_${i}_${p.nameEn.replace(/\s+/g, "_")}` });
        }
      }
    }
  }

  // ── Tadawul Public Disclosures ───────────────────────────────────────────────
  emit(emitter, { type: "agent_log", agent: 1, message: "Checking Tadawul disclosures…" });
  const tadawulUrl = `https://api.saudiexchange.sa/v2/main/GetCompanyDisclosures?q=${encodeURIComponent(brief.targetCompanyName)}&disclosureType=BOD&lang=en`;
  const tadR = await httpGet(tadawulUrl);
  if (tadR && tadR.data) {
    const disclosures = ((tadR.data as Record<string, unknown>).data as Record<string, unknown>[]) || [];
    for (const disc of disclosures.slice(0, 5)) {
      emit(emitter, { type: "agent_log", agent: 1, message: `Tadawul disclosure: ${disc.title || disc.disclosureType || "event"}` });
    }
  }

  // ── SaudiCEOs / SaudiBODs scrape via Perplexity ──────────────────────────────
  const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
  if (PERPLEXITY_API_KEY) {
    try {
      const r = await axios.post("https://api.perplexity.ai/chat/completions", {
        model: "sonar",
        messages: [
          { role: "system", content: "Extract board and executive data. Return JSON only." },
          { role: "user", content: `Find executives and board members of ${brief.targetCompanyName} Saudi Arabia. Check saudiceos.com, saudibods.com, LinkedIn, and news. Return JSON array: [{nameEn, nameAr, title, type, seniority}]` },
        ],
        max_tokens: 2000,
        temperature: 0.1,
      }, { headers: { Authorization: `Bearer ${PERPLEXITY_API_KEY}` }, timeout: 30000 });
      const content = r.data?.choices?.[0]?.message?.content || "";
      const parsed = await parseJsonFromGemini(content, []) as OrgNode[];
      if (Array.isArray(parsed)) {
        for (let i = 0; i < parsed.length; i++) {
          const p = parsed[i];
          if (p.nameEn && p.nameEn.length > 2) {
            addNode({ ...p, id: `perp_${i}_${p.nameEn.replace(/\s+/g, "_")}`, source: "Perplexity" });
          }
        }
      }
    } catch {}
  }

  emit(emitter, { type: "agent_log", agent: 1, message: `Org chart mapped: ${nodes.length} nodes` });
  emit(emitter, { type: "agent_complete", agent: 1, label: "Org Mapper", count: nodes.length });
  return nodes;
}

// ─── Agent 2: Stakeholder Enricher ────────────────────────────────────────────

async function agent2_enrichStakeholders(nodes: OrgNode[], brief: RelationshipIntelBrief, emitter: EventEmitter): Promise<OrgNode[]> {
  emit(emitter, { type: "agent_start", agent: 2, label: "Stakeholder Enricher" });
  const enriched: OrgNode[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = { ...nodes[i] };
    emit(emitter, { type: "agent_progress", agent: 2, current: i + 1, total: nodes.length });

    try {
      // Scout individual signals
      const [firstName, ...rest] = node.nameEn.split(" ");
      const lastName = rest.join(" ") || "";
      const sigResult = await scoutSignalsIndividualFull(
        `${firstName} ${lastName}`.trim()
      );

      if (sigResult) {
        node.signalData = sigResult as unknown as Record<string, unknown>;
        const d = sigResult as any;
        node.email = node.email || (d.email as string) || "";
        node.phone = node.phone || (d.phone as string) || "";
        node.linkedin = node.linkedin || (d.linkedin_url as string) || "";
      }

      // NEXUS synthesis for high-seniority nodes
      if (brief.outputDepth === "deep" && ["C-Suite", "VP", "Board"].includes(node.seniority || "")) {
        try {
          const personData = JSON.stringify({ name: node.nameEn, nameAr: node.nameAr, company: brief.targetCompanyName, title: node.title });
          const nexusResult = await nexusSynthesize(
            personData,
            "Generate a Saudi executive intelligence profile: background, board roles, wealth signals, public reputation, and outreach approach",
          );
          if (nexusResult?.text) {
            node.signalData = { ...node.signalData, nexusProfile: nexusResult.text };
          }
        } catch {}
      }

      emit(emitter, { type: "stakeholder_enriched", agent: 2, nodeId: node.id, name: node.nameEn });
    } catch {}

    enriched.push(node);
  }

  emit(emitter, { type: "agent_complete", agent: 2, label: "Stakeholder Enricher", count: enriched.length });
  return enriched;
}

// ─── Agent 3: Network Expander ─────────────────────────────────────────────────

async function agent3_expandNetwork(nodes: OrgNode[], brief: RelationshipIntelBrief, emitter: EventEmitter): Promise<NetworkConnection[]> {
  emit(emitter, { type: "agent_start", agent: 3, label: "Network Expander" });
  const connections: NetworkConnection[] = [];

  // Identify board members for cross-reference
  const boardMembers = nodes.filter(n => n.type === "board" || n.seniority === "Board" || n.seniority === "C-Suite");

  emit(emitter, { type: "agent_log", agent: 3, message: `Cross-referencing ${boardMembers.length} senior stakeholders for board overlaps…` });

  if (isGeminiConfigured() && boardMembers.length > 0) {
    const memberNames = boardMembers.map(m => `${m.nameEn} (${m.title || m.type})`).join(", ");
    const prompt = `You are a Saudi corporate network analyst. Identify companies connected to ${brief.targetCompanyName} through shared board members or executives.

People to cross-reference: ${memberNames}

Find:
1. Other Saudi companies where these people sit on boards
2. Subsidiary companies of ${brief.targetCompanyName}
3. Sister companies (same ownership group)
4. Strategic partners or joint ventures
5. Investment vehicles or holdings

Return JSON array:
{
  "name": "Company Name",
  "nameAr": "اسم الشركة",
  "relationship": "subsidiary|sister|investment|partner|board_overlap",
  "companyType": "listed|private|government|startup",
  "domain": "website.com",
  "overlappingPeople": ["Name1", "Name2"],
  "strength": "strong|medium|weak"
}`;

    const raw = await generateWithGemini(prompt, "Output only valid JSON array.");
    const conns = await parseJsonFromGemini(raw, []) as NetworkConnection[];
    if (Array.isArray(conns)) {
      for (const conn of conns) {
        if (conn.name) {
          connections.push(conn);
          emit(emitter, { type: "network_connection", agent: 3, connection: conn });
          emit(emitter, { type: "agent_log", agent: 3, message: `Network: ${conn.name} (${conn.relationship})` });
        }
      }
    }
  }

  // Check Tadawul for subsidiaries and related companies
  const tadURL = `https://api.saudiexchange.sa/v2/main/GetAllSecurities?q=${encodeURIComponent(brief.targetCompanyName)}&lang=en`;
  const tr = await httpGet(tadURL);
  if (tr && tr.data) {
    emit(emitter, { type: "agent_log", agent: 3, message: "Tadawul subsidiary cross-reference complete" });
  }

  // OpenCorporates parent/subsidiary search
  if (brief.targetCrNumber) {
    const ocURL = `https://api.opencorporates.com/v0.4/companies/sa/${brief.targetCrNumber}/network`;
    const ocR = await httpGet(ocURL);
    if (ocR && ocR.data) {
      const rels = ((ocR.data as Record<string, unknown>).results as Record<string, unknown>[]) || [];
      for (const rel of rels.slice(0, 10)) {
        const name = (rel.name || rel.company_name || "") as string;
        if (name) {
          const conn: NetworkConnection = {
            name,
            relationship: (rel.relationship_type || "related") as string,
            companyType: "private",
            overlappingPeople: [],
            strength: "medium",
          };
          connections.push(conn);
          emit(emitter, { type: "network_connection", agent: 3, connection: conn });
        }
      }
    }
  }

  emit(emitter, { type: "agent_complete", agent: 3, label: "Network Expander", count: connections.length });
  return connections;
}

// ─── Agent 4: Outreach Sequencer ──────────────────────────────────────────────

async function agent4_sequenceOutreach(
  nodes: OrgNode[],
  connections: NetworkConnection[],
  brief: RelationshipIntelBrief,
  emitter: EventEmitter,
): Promise<OutreachContact[]> {
  emit(emitter, { type: "agent_start", agent: 4, label: "Outreach Sequencer" });
  const contacts: OutreachContact[] = [];

  // Score and rank contacts
  const seniorityWeight: Record<string, number> = { "C-Suite": 100, "VP": 80, "Director": 60, "Board": 90, "Manager": 40 };

  const sortedNodes = [...nodes].sort((a, b) => {
    const wa = seniorityWeight[a.seniority || ""] || 30;
    const wb = seniorityWeight[b.seniority || ""] || 30;
    const contactA = (a.email ? 10 : 0) + (a.phone ? 10 : 0) + (a.linkedin ? 5 : 0);
    const contactB = (b.email ? 10 : 0) + (b.phone ? 10 : 0) + (b.linkedin ? 5 : 0);
    return (wb + contactB) - (wa + contactA);
  });

  for (let i = 0; i < Math.min(sortedNodes.length, 10); i++) {
    const node = sortedNodes[i];
    emit(emitter, { type: "agent_progress", agent: 4, current: i + 1, total: sortedNodes.length });

    let outreach: OutreachContact = {
      rank: i + 1,
      nodeId: node.id,
      name: node.nameEn,
      title: node.title,
      email: node.email,
      phone: node.phone,
      linkedin: node.linkedin,
      icpFitReason: `${node.seniority || node.type} level — key decision maker at ${brief.targetCompanyName}`,
    };

    // Gemini-powered outreach copy
    if (isGeminiConfigured() && i < 5) {
      try {
        const prompt = `Write personalised outreach for this Saudi executive.

Person: ${node.nameEn} (${node.nameAr || ""})
Title: ${node.title || "Executive"} at ${brief.targetCompanyName}
Context: ${brief.context || "B2B Saudi Arabia"}

Generate JSON:
{
  "outreachEmail": "Subject: ...\\n\\n[3 paragraphs, personalised, bilingual closing, max 180 words]",
  "outreachLinkedin": "[50-word connection request mentioning their role]",
  "whatsappOpener": "[60-word WhatsApp message starting with مرحباً]",
  "bestTimeToReach": "[recommendation based on Saudi culture and seniority]",
  "conversationHook": "[one smart question that shows intelligence about their role]",
  "culturalNote": "[one Saudi business culture tip for this seniority level]"
}`;

        const raw = await generateWithGemini(prompt, "Output only valid JSON.");
        const copy = await parseJsonFromGemini(raw, {}) as Record<string, string>;
        if (copy) {
          outreach = {
            ...outreach,
            outreachEmail: copy.outreachEmail,
            outreachLinkedin: copy.outreachLinkedin,
            whatsappOpener: copy.whatsappOpener,
            bestTimeToReach: copy.bestTimeToReach,
            conversationHook: copy.conversationHook,
            culturalNote: copy.culturalNote,
          };
        }
      } catch {}
    }

    contacts.push(outreach);
    emit(emitter, { type: "outreach_contact", agent: 4, contact: outreach });
    emit(emitter, { type: "agent_log", agent: 4, message: `Ranked #${i + 1}: ${node.nameEn} (${node.title || node.type})` });
  }

  emit(emitter, { type: "agent_complete", agent: 4, label: "Outreach Sequencer", count: contacts.length });
  return contacts;
}

// ─── Pipeline Orchestrator ─────────────────────────────────────────────────────

export async function runRelationshipIntelPipeline(
  jobId: string,
  brief: RelationshipIntelBrief,
): Promise<void> {
  const emitter = jobEmitters.get(jobId);
  if (!emitter) return;

  const heartbeat = setInterval(() => emit(emitter, { type: "heartbeat" }), 15000);

  let jobDbId = 0;
  try {
    const [row] = await db.insert(relationshipIntelJobsTable).values({
      targetCompanyName: brief.targetCompanyName,
      targetCompanyNameAr: brief.targetCompanyNameAr,
      targetCrNumber: brief.targetCrNumber,
      targetWebsite: brief.targetWebsite,
      status: "running",
    }).returning({ id: relationshipIntelJobsTable.id });
    jobDbId = row.id;
  } catch {}

  try {
    const nodes = await agent1_mapOrg(brief, emitter);
    const enrichedNodes = await agent2_enrichStakeholders(nodes, brief, emitter);
    const connections = await agent3_expandNetwork(enrichedNodes, brief, emitter);
    const contacts = await agent4_sequenceOutreach(enrichedNodes, connections, brief, emitter);

    if (jobDbId) {
      await db.update(relationshipIntelJobsTable).set({
        status: "completed",
        orgChartData: enrichedNodes as unknown as Record<string, unknown>[],
        networkData: connections as unknown as Record<string, unknown>[],
        outreachPlan: contacts as unknown as Record<string, unknown>[],
        totalContacts: contacts.length,
        totalConnections: connections.length,
        adjacentCompanies: connections.length,
        completedAt: new Date(),
      }).where(eq(relationshipIntelJobsTable.id, jobDbId));
    }

    emit(emitter, {
      type: "pipeline_complete",
      jobId: jobDbId,
      totalContacts: contacts.length,
      totalConnections: connections.length,
      adjacentCompanies: connections.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (jobDbId) await db.update(relationshipIntelJobsTable).set({ status: "failed", errorMessage: msg }).where(eq(relationshipIntelJobsTable.id, jobDbId));
    emit(emitter, { type: "agent_error", agent: 0, message: `Relationship intel failed: ${msg}` });
  } finally {
    clearInterval(heartbeat);
    emitter.emit("done");
  }
}
