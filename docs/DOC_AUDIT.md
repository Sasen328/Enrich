# Documentation Audit

The repo has accumulated ~26k lines of overlapping docs from multiple "replication guide" generations. This audit recommends what to keep, merge, or delete.

**Status: EXECUTED.** Full cleanup applied on the `claude/audit-leadgene-docs-functionality-b9xoS` branch — 4 merges, 11 deletes, `docs/docs/` renamed to `docs/replication/`.

## TL;DR

| Action | Count |
|---|---|
| KEEP (canonical) | 4 |
| MERGE (extract value, then delete source) | 4 |
| DELETE (superseded or non-doc) | 7 |

## Recommendations

### KEEP — canonical references

| File | Lines | Why keep |
|---|---|---|
| `DATABASEBUILDER_FEATURE_DOC.md` | ~2,600 | Best-written builder spec. The 04-replication guide is a redundant earlier copy. |
| `NEXUS_ENGINE.md` | ~4,700 | Authoritative Nexus 6-layer reference. Too detailed to inline into ARCHITECTURE.md. Link from there. |
| `docs/docs/01-masaar-engine-replication.md` | 1,411 | Actual step-by-step Masaar build guide — the operator can copy-and-run this. |
| `docs/docs/02-masar-database-replication.md` | 1,462 | Same — operator-grade replication of the Masar database. |

### MERGE — useful content, then delete the source

| File | Target | Action |
|---|---|---|
| `docs/docs/frontend-replication-guide.md` (366 lines) | `docs/SETUP.md` | Append as "Frontend Replication Checklist" section. |
| `docs/docs/03-prosengine-replication.md` (1,529 lines) | new `docs/engines/prosengine.md` | Extract; ProsEngine has no dedicated engine doc yet. |
| `docs/docs/masaar-prosengine-technical-reference.md` (1,244 lines) | `docs/API.md` | Append "Event reference & job polling" section. |
| `docs/docs/tech-stack-full.md` (996 lines) | `docs/SETUP.md` | Inline the dependency tables into the Prerequisites section. |

### DELETE — superseded, too shallow, or non-documentation

| File | Lines | Why delete |
|---|---|---|
| `docs/docs/frontend-source-code.md` | ~498,000 | Raw code dump. Not documentation. Already flagged. |
| `docs/docs/fullstack-complete-replication-guide.md` | 1,918 | Just an index that links to the 4 numbered guides; redundant once you have those. |
| `docs/docs/prosengine-full-stack-replication-guide.md` | 2,007 | Near-duplicate of 03-prosengine-replication.md. |
| `docs/docs/04-ai-database-builder-replication.md` | 1,583 | Older, rougher copy of `DATABASEBUILDER_FEATURE_DOC.md`. |
| `docs/docs/ai-database-builder.md` | 775 | Short version of the same; superseded. |
| `docs/docs/masaar-engine.md` | 388 | Shallow teaser; superseded by 01-masaar-engine-replication.md and `docs/engines/masaar.md` (TBD). |
| `docs/docs/masar-database.md` | 524 | Subsumed by `docs/DATABASE.md` + 02-masar-database-replication.md. |
| `docs/docs/pros-engine.md` | 644 | Shallow teaser; replaced by the merge above. |
| `replit.md` (root) | ~500 | Deleted — repo no longer targets Replit; content is in `README.md` + `docs/SETUP.md`. |

## After the cleanup, the doc tree looks like

```
README.md
NEXUS_ENGINE.md               ← KEEP (linked from ARCHITECTURE)
DATABASEBUILDER_FEATURE_DOC.md ← KEEP (linked from DATABASE + engines)
docs/
├── SETUP.md                   ← merged: frontend-replication-guide + tech-stack-full
├── ENV.md
├── ARCHITECTURE.md
├── API.md                     ← merged: masaar-prosengine-technical-reference
├── DATABASE.md
├── NEXUS_MIGRATION.md
├── OPERATOR_GUIDE.md          ← NEW (this turn)
├── STATUS.md                  ← NEW (this turn)
├── DOC_AUDIT.md               ← NEW (this turn)
└── engines/
    ├── orcengine.md
    ├── scout.md
    ├── signals.md
    ├── lead-factory.md
    ├── company-intel.md
    ├── person-intel.md
    ├── sa-market.md
    └── prosengine.md          ← merged from 03-prosengine-replication.md
docs/replication/              ← rename from docs/docs/ for clarity
    ├── 01-masaar-engine-replication.md
    └── 02-masar-database-replication.md
```

## Execution plan

If you say "do the cleanup":

1. Append the merge targets (4 files into 4 targets).
2. Delete the 7 superseded files + the 4 merged sources.
3. Rename `docs/docs/` → `docs/replication/`.
4. Update cross-links in `README.md`.

Net result: doc tree shrinks from ~535k lines to ~30k lines while keeping every useful piece of operator knowledge.
