/**
 * Activepieces Webhook Client — Layer 6 of the NEXUS Engine
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Emits structured webhook events to a self-hosted Activepieces instance after
 * every major pipeline completion. Enables post-pipeline automation:
 *
 *   • Push high-scoring leads → HubSpot / Salesforce / Airtable
 *   • Slack / Teams notifications when runs complete
 *   • Auto-trigger enrichment on new Masaar companies
 *   • Trigger email sequences in Mailchimp / Instantly
 *   • Write to Google Sheets / Notion databases
 *   • Chain into any of Activepieces' 200+ integrations
 *
 * Configuration (env vars):
 *   ACTIVEPIECES_URL          Base URL of your Activepieces instance
 *                             e.g. https://activepieces.yourcompany.com
 *   ACTIVEPIECES_API_KEY      API key for authenticating webhook calls
 *
 * Flow IDs (set in ACTIVEPIECES_FLOW_IDS as JSON, or individually):
 *   ACTIVEPIECES_FLOW_LEAD_FACTORY    Flow triggered after Lead Factory completes
 *   ACTIVEPIECES_FLOW_SIGNAL_PUSH     Flow triggered after Signal Monitor push
 *   ACTIVEPIECES_FLOW_MASAAR          Flow triggered after Masaar pipeline completes
 *   ACTIVEPIECES_FLOW_BUILDER         Flow triggered after AI Database Builder run
 *   ACTIVEPIECES_FLOW_PROSPENGINE     Flow triggered after ProsEngine completes
 *
 * Activepieces docs: https://www.activepieces.com/docs
 * ─────────────────────────────────────────────────────────────────────────────
 */

import axios from "axios";

// ── Config ─────────────────────────────────────────────────────────────────────

function getConfig() {
  return {
    baseUrl: (process.env.ACTIVEPIECES_URL || "").replace(/\/$/, ""),
    apiKey: process.env.ACTIVEPIECES_API_KEY || "",
    flows: {
      leadFactory:  process.env.ACTIVEPIECES_FLOW_LEAD_FACTORY || "",
      signalPush:   process.env.ACTIVEPIECES_FLOW_SIGNAL_PUSH || "",
      masaar:       process.env.ACTIVEPIECES_FLOW_MASAAR || "",
      builder:      process.env.ACTIVEPIECES_FLOW_BUILDER || "",
      prosEngine:   process.env.ACTIVEPIECES_FLOW_PROSPENGINE || "",
    },
  };
}

function isConfigured(): boolean {
  const { baseUrl, apiKey } = getConfig();
  return !!baseUrl && !!apiKey;
}

// ── Core webhook emitter ───────────────────────────────────────────────────────

export interface WebhookPayload {
  event: string;
  source: "prospectsa";
  timestamp: string;
  environment: string;
  data: Record<string, unknown>;
}

export async function triggerWebhook(flowId: string, payload: Omit<WebhookPayload, "source" | "timestamp" | "environment">): Promise<void> {
  if (!isConfigured() || !flowId) return;

  const { baseUrl, apiKey } = getConfig();
  const body: WebhookPayload = {
    ...payload,
    source: "prospectsa",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
  };

  try {
    await axios.post(
      `${baseUrl}/api/v1/webhooks/${flowId}`,
      body,
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
          "X-ProspectSA-Source": "nexus-layer6",
        },
        timeout: 8000,
      },
    );
    console.log(`[Activepieces] ✓ Webhook fired → flow ${flowId} (${payload.event})`);
  } catch (err) {
    // Non-blocking — never fail the pipeline because of automation errors
    console.warn(`[Activepieces] Webhook failed for flow ${flowId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Named pipeline hooks ───────────────────────────────────────────────────────

/**
 * Fired when the Lead Factory 7-agent pipeline completes.
 * Payload includes the scored leads summary, tier breakdown, job metadata.
 */
export async function onLeadFactoryComplete(params: {
  jobId: string;
  totalPublished: number;
  totalRejected: number;
  tierBreakdown: Record<string, number>;
  brief: Record<string, unknown>;
  sampleLeads?: Array<{ companyName?: string; icpScore?: number; priorityTier?: string; industry?: string; city?: string }>;
}): Promise<void> {
  const { flows } = getConfig();
  await triggerWebhook(flows.leadFactory, {
    event: "lead_factory.pipeline_complete",
    data: {
      ...params,
      message: `Lead Factory completed: ${params.totalPublished} leads published (${params.tierBreakdown?.A || 0} Tier-A)`,
    },
  });
}

/**
 * Fired when the Signal Monitor push completes.
 * Payload includes all collected alerts across sources.
 */
export async function onSignalPushComplete(params: {
  jobId: string;
  totalSignals: number;
  sourceBreakdown: Record<string, number>;
  highPrioritySignals?: Array<{ headline: string; company?: string; signalType: string; source: string }>;
}): Promise<void> {
  const { flows } = getConfig();
  await triggerWebhook(flows.signalPush, {
    event: "signal_monitor.push_complete",
    data: {
      ...params,
      message: `Signal Monitor: ${params.totalSignals} alerts across ${Object.keys(params.sourceBreakdown).length} sources`,
    },
  });
}

/**
 * Fired when a Masaar CR intelligence pipeline completes.
 * Payload includes the company profile, CR data, and report summary.
 */
export async function onMasaarComplete(params: {
  crNumber: string;
  companyName?: string;
  companyNameAr?: string;
  reportSections: number;
  conflictsFound: number;
  hasAOA: boolean;
  hasNajiz: boolean;
}): Promise<void> {
  const { flows } = getConfig();
  await triggerWebhook(flows.masaar, {
    event: "masaar.pipeline_complete",
    data: {
      ...params,
      message: `Masaar report ready: ${params.companyName || params.crNumber} (${params.reportSections} sections, ${params.conflictsFound} conflicts)`,
    },
  });
}

/**
 * Fired when the AI Database Builder completes a harvest or enrichment run.
 */
export async function onBuilderComplete(params: {
  jobId?: string;
  harvested: number;
  enriched: number;
  sources: string[];
  industry?: string;
  city?: string;
}): Promise<void> {
  const { flows } = getConfig();
  await triggerWebhook(flows.builder, {
    event: "builder.run_complete",
    data: {
      ...params,
      message: `Builder run complete: ${params.harvested} harvested, ${params.enriched} enriched from ${params.sources.join(", ")}`,
    },
  });
}

/**
 * Fired when ProsEngine completes a company or persona intelligence run.
 */
export async function onProsEngineComplete(params: {
  mode: "company" | "persona" | "website" | "seeder";
  subject: string;
  agentsRun: number;
  insightsGenerated: number;
  hasContacts: boolean;
}): Promise<void> {
  const { flows } = getConfig();
  await triggerWebhook(flows.prosEngine, {
    event: `prospengine.${params.mode}_complete`,
    data: {
      ...params,
      message: `ProsEngine ${params.mode} intel complete: ${params.subject} (${params.agentsRun} agents, ${params.insightsGenerated} insights)`,
    },
  });
}

// ── Status check ───────────────────────────────────────────────────────────────

export function getActivepiecesStatus(): {
  configured: boolean;
  baseUrl: string;
  flowsConfigured: Record<string, boolean>;
} {
  const { baseUrl, flows } = getConfig();
  return {
    configured: isConfigured(),
    baseUrl: baseUrl || "(not set)",
    flowsConfigured: {
      leadFactory:  !!flows.leadFactory,
      signalPush:   !!flows.signalPush,
      masaar:       !!flows.masaar,
      builder:      !!flows.builder,
      prosEngine:   !!flows.prosEngine,
    },
  };
}
