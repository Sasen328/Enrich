# Lead Factory UI Redesign — Apollo-parity Spec

**Status:** spec for review. No code written yet.

## Goal

Replace the single-page Lead Factory form (`pages/lead-factory/index.tsx`, 1769 lines) with two filter-first routes — **Person** and **Company** — that mirror Apollo's prospecting UX. Same backend pipeline; richer input + output surface.

## Routes

| URL | Page file | Primary action |
|---|---|---|
| `/lead-factory` | `pages/lead-factory/index.tsx` (router shell) | Hub: pick Person or Company; shows recent runs |
| `/lead-factory/person` | `pages/lead-factory/person.tsx` (new) | Search **people** matching filters; harvest their companies as side-effect |
| `/lead-factory/company` | `pages/lead-factory/company.tsx` (new) | Search **companies** matching filters; harvest contacts as side-effect |
| `/lead-factory/runs/:jobId` | `pages/lead-factory/run.tsx` (new) | Live SSE view of one running job + result table + export |
| `/lead-factory/results/:jobId` | `pages/lead-factory/results.tsx` (new) | Final results table (replaces inline pane on `index.tsx`) |

Wouter routes already exist; we add 4 new ones.

## Person route — filter panel

Apollo-parity filters, grouped. All are AND-combined; multi-select within a group is OR.

### Identity
- Full name (text)
- Title / role (multi-select + free-text)
- Seniority level: `c_level | vp | director | manager | senior | mid | junior | entry`
- Department: `engineering | sales | marketing | operations | finance | hr | legal | product | it | executive`
- Function (sub-department): free-tag multi-select
- Years in current role: range slider (0–20)
- Years of experience: range slider (0–40)
- Education degree: bachelor / master / PhD / MBA / certificate

### Location
- Country (default: Saudi Arabia, pinned)
- Region (Riyadh, Eastern Province, Makkah, Madinah, etc.)
- City (multi-select)
- Time zone

### Languages
- Languages spoken: Arabic / English / Hindi / Urdu / French / Tagalog / other

### Their company (firmographic narrowing)
- Industry / sub-industry
- Employee bands: `1-10 | 11-50 | 51-200 | 201-500 | 501-1000 | 1001-5000 | 5001+`
- Revenue bands: `<1M | 1-10M | 10-50M | 50-250M | 250M-1B | 1B+` (SAR)
- Founded year: range
- Funding stage: `bootstrapped | seed | series_a | series_b | series_c+ | public | private_equity`
- Technologies used: Wappalyzer tag multi-select
- CR entity type: `corporation | llc | sole_proprietorship | government`

### Intent
- Buying signals: dropdown from Signals engine (`hiring_surge`, `funding_round`, `leadership_change`, `expansion`, `compliance_event`)
- Signal recency: last 7 / 30 / 90 / 365 days
- Min ICP score: slider 0–100

### Output controls
- Target count: 25 / 50 / 100 / 250 / 500
- Enrichment depth: `shallow` (name+title only) / `standard` (+contact) / `deep` (+social + history)
- Auto-trigger downstream: checkbox → fires `autoEnrichDownstream: true` (Signals + Relationship Intel for each new company)

## Company route — filter panel

Same firmographics as above + intent + output, **without** the per-person identity block. Adds:

- **Has executives:** checkbox (excludes shell companies)
- **Has website:** checkbox
- **Has phone / has verified email:** checkboxes
- **Saudization rate band:** `<25% | 25-50% | 50-75% | 75%+` (when available from Nitaqat data)
- **Listed on Tadawul:** checkbox

## Backend additions

The current `leadFactoryBriefSchema` accepts most of these as optional fields. New fields needed in `lib/lead-factory-engine.ts`:

```ts
// Add to leadFactoryBriefSchema:
mode: z.enum(["person", "company"]).default("company"),
buyingSignals: z.array(z.string()).optional(),
signalRecencyDays: z.number().optional(),
minIcpScore: z.number().min(0).max(100).optional(),
enrichmentDepth: z.enum(["shallow", "standard", "deep"]).optional(),
hasExecutives: z.boolean().optional(),
hasWebsite: z.boolean().optional(),
hasVerifiedEmail: z.boolean().optional(),
saudizationBand: z.string().optional(),
tadawulListedOnly: z.boolean().optional(),
languages: z.array(z.string()).optional(),
yearsInRoleMin: z.number().optional(),
yearsInRoleMax: z.number().optional(),
yearsExperienceMin: z.number().optional(),
yearsExperienceMax: z.number().optional(),
educationDegree: z.array(z.string()).optional(),
fundingStage: z.array(z.string()).optional(),
revenueBands: z.array(z.string()).optional(),
employeeBands: z.array(z.string()).optional(),
technologies: z.array(z.string()).optional(),
foundedYearMin: z.number().optional(),
foundedYearMax: z.number().optional(),
```

Agent 1 (ICP Mapper) already accepts most of this in `brief`; map the new fields into the source-prioritisation prompt. Agent 5 (Validate) filters on `hasExecutives` / `hasVerifiedEmail`. Agent 6 (Scoring) uses `minIcpScore` as a hard floor instead of a sort.

## Result table

Replace the current inline result list (`index.tsx:1568+`) with a TanStack Table column set:

| Col | Source | Notes |
|---|---|---|
| ✓ | – | Row select for bulk publish/export |
| Company | `companyName` + `companyNameAr` (RTL aware) | Click → opens drawer |
| Domain | `domain` | Linkified |
| Person (Person mode only) | `keyExecutives[0].fullName` + title | |
| Phone | `phone` | Click-to-call |
| Email | `email` + green checkmark when `emailTrusted: true` | |
| City | `city` | |
| Industry | `industry` / `subIndustry` | |
| ICP score | `icpScore` | Badge w/ tier color: `priorityTier` |
| Signals | `signalData.length` + 3-letter signal-type badges | Hover → tooltip |
| Validation | `validationStatus` | Pending / Verified / Rejected colors |
| Outreach | `outreachEmail` excerpt | Click → expands drawer with email + LinkedIn + WhatsApp templates |
| Published | `publishedCompanyId` | ✓ if bridged |

Drawer (per row, slides from right): full firmographics + signal timeline + outreach previews (email/LinkedIn/WhatsApp) + actions (Run Person Intel, Run Relationship Intel, Publish, Reject).

## Output report

Export formats wired via `POST /api/lead-factory/results/:jobId/export?format=…`:

| Format | Content |
|---|---|
| **CSV** | Flat table — current `lead_factory_results` columns |
| **XLSX** | Same + auto-filter + frozen header + tab per priority tier |
| **PDF** | Per-prospect 1-pager: firmographics, signal timeline, outreach previews. Logo-headered. Generated via existing `prosengine-chat.ts` PPT path with new template. |
| **PPT** | Deck: 1 cover, 1 segment overview, 1 slide per priority-A prospect, 1 appendix. |
| **JSON** | Raw `lead_factory_results` rows |
| **Push to CRM** | New endpoint `POST /api/lead-factory/results/:jobId/push-crm?provider=hubspot\|salesforce\|pipedrive` — out of scope for v1 |

Add report cover stats: total discovered / enriched / validated / published, breakdown by priority tier, breakdown by signal type, average ICP score, geographic distribution.

## Mock layout (text)

```
┌──────────────────────────────────────────────────────────────────────┐
│ Lead Factory ▸ Company                                  [New Search] │
├──────────────────────────────────────────────────────────────────────┤
│ ┌────────────────────────┐  ┌──────────────────────────────────────┐ │
│ │ FILTERS                │  │ RESULTS  (preview — final after run) │ │
│ │ ─────────              │  │  3,742 estimated matches             │ │
│ │ Industry         ▼     │  │ ┌──────────────────────────────────┐ │ │
│ │ Sub-industry     ▼     │  │ │ ✓ Company  Domain  ICP   Signals │ │ │
│ │ Employees      [-][- ] │  │ │ □ Aramco   ...     94    🔥🎯💰   │ │ │
│ │ Revenue        [-][- ] │  │ │ □ STC      ...     87    🎯       │ │ │
│ │ Region           ▼     │  │ │ □ Saudia   ...     85    💰       │ │ │
│ │ City             ▼     │  │ │ ...                              │ │ │
│ │ Buying signals   ▼     │  │ └──────────────────────────────────┘ │ │
│ │ Min ICP score   [60]   │  │ [Export▾] [Run Job →]                │ │
│ │ ─────────              │  └──────────────────────────────────────┘ │
│ │ Target count: [100▾]   │                                            │
│ │ Enrichment:   [deep ▾] │                                            │
│ │ ☑ Auto-enrich downstream│                                           │
│ │ [ Run Job → ]          │                                            │
│ └────────────────────────┘                                            │
└──────────────────────────────────────────────────────────────────────┘
```

## Build order

1. **Backend Zod schema extension** (1 file, ~80 LOC). No engine logic changes — Agent prompts already consume `brief` as JSON.
2. **Filter panel component** (`components/lead-factory/FilterPanel.tsx`, ~500 LOC). Pure presentation; emits `LeadFactoryBrief` on change.
3. **Result table component** (`components/lead-factory/ResultTable.tsx`, ~300 LOC). TanStack Table + row drawer.
4. **Pages** (`person.tsx`, `company.tsx`, `run.tsx`, `results.tsx`, ~150 LOC each).
5. **Export endpoint backend** — new `POST /results/:jobId/export?format=xlsx|pdf|ppt`. Existing CSV/JSON already wired.
6. **Hub** (`index.tsx` rewrite) — recent runs + entry cards. ~200 LOC.

**Total estimate: 2,200–2,800 LOC across 9 files. ~3 working days.**

## Out of scope for v1

- CRM push (HubSpot / Salesforce / Pipedrive integrations) — adds OAuth + per-provider mapping.
- Live "estimated matches" counter — needs a `/lead-factory/estimate` endpoint that runs a dry-pass through the source-prioritiser.
- Saved searches / templates.
- Multi-user / team workspaces.

These can land in v2 once v1 is in production.
