/**
 * Composer — connectors registry. Built-in scrapers + MCP servers + (future) OAuth.
 */

export type ConnectorCategory = "scraping" | "prod" | "files" | "crm" | "msg";

export interface ComposerConnector {
  id: string;
  label: string;
  category: ConnectorCategory;
  /** "ok" = ready to use; "req" = needs OAuth / API key */
  status: "ok" | "req";
  /** If connected, the env var or MCP server providing access */
  via?: string;
}

export const BUILTIN_CONNECTORS: ComposerConnector[] = [
  // Scraping (mostly ready in container)
  { id: "tavily",         label: "Tavily",          category: "scraping", status: "ok", via: "TAVILY_API_KEY" },
  { id: "playwright",     label: "Playwright",      category: "scraping", status: "ok", via: "container" },
  { id: "chrome-devtools",label: "Chrome DevTools", category: "scraping", status: "ok", via: "container" },
  { id: "crawl4ai",       label: "Crawl4AI",        category: "scraping", status: "ok", via: "scout-venv" },
  { id: "beautifulsoup",  label: "BeautifulSoup",   category: "scraping", status: "ok", via: "scout-venv" },
  { id: "cheerio",        label: "Cheerio",         category: "scraping", status: "ok", via: "node_modules" },
  { id: "omnisearch",     label: "OmniSearch",      category: "scraping", status: "ok", via: "MCP" },
  { id: "serena",         label: "Serena",          category: "scraping", status: "ok", via: "MCP" },
  { id: "huggingface",    label: "HuggingFace",     category: "scraping", status: "ok", via: "MCP" },

  // Productivity
  { id: "github",   label: "GitHub",   category: "prod", status: "req" },
  { id: "slack",    label: "Slack",    category: "prod", status: "req" },
  { id: "notion",   label: "Notion",   category: "prod", status: "req" },
  { id: "linear",   label: "Linear",   category: "prod", status: "req" },
  { id: "jira",     label: "Jira",     category: "prod", status: "req" },
  { id: "asana",    label: "Asana",    category: "prod", status: "req" },
  { id: "trello",   label: "Trello",   category: "prod", status: "req" },
  { id: "clickup",  label: "ClickUp",  category: "prod", status: "req" },

  // Files
  { id: "gdrive",    label: "Google Drive", category: "files", status: "req" },
  { id: "gsheets",   label: "Google Sheets",category: "files", status: "req" },
  { id: "onedrive",  label: "OneDrive",     category: "files", status: "req" },
  { id: "office365", label: "Office365",    category: "files", status: "req" },
  { id: "dropbox",   label: "Dropbox",      category: "files", status: "req" },
  { id: "s3",        label: "S3 / R2",      category: "files", status: "req" },
  { id: "airtable",  label: "Airtable",     category: "files", status: "req" },
  { id: "supabase",  label: "Supabase",     category: "files", status: "req" },

  // CRM
  { id: "hubspot",    label: "HubSpot",   category: "crm", status: "req" },
  { id: "salesforce", label: "Salesforce",category: "crm", status: "req" },
  { id: "pipedrive",  label: "Pipedrive", category: "crm", status: "req" },
  { id: "zoho",       label: "Zoho CRM",  category: "crm", status: "req" },
  { id: "apollo",     label: "Apollo.io", category: "crm", status: "req" },
  { id: "explorium",  label: "Explorium", category: "crm", status: "req", via: "EXPLORIUM_API_KEY" },

  // Messaging
  { id: "whatsapp",  label: "WhatsApp Cloud", category: "msg", status: "req" },
  { id: "telegram",  label: "Telegram",       category: "msg", status: "req" },
  { id: "discord",   label: "Discord",        category: "msg", status: "req" },
  { id: "smtp",      label: "Email (SMTP)",   category: "msg", status: "req" },
  { id: "sendgrid",  label: "SendGrid",       category: "msg", status: "req" },
  { id: "resend",    label: "Resend",         category: "msg", status: "req" },
];

export function findConnector(id: string): ComposerConnector | undefined {
  return BUILTIN_CONNECTORS.find((c) => c.id === id);
}
