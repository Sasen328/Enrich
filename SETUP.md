# ProspectSA — Quick Start

**Full standalone guide (no Replit):** see `STANDALONE_SETUP.md`
**All docs:** see `docs/` and `.claude/docs/`

## 3-command start (Replit)
Secrets already in Replit → just run the workflow.

## 3-command start (local)

```bash
# 1. Fill DATABASE_URL in .env, then:
pnpm install && pnpm --filter @workspace/db run db:push

# 2. Seed — pick one:
psql $DATABASE_URL -f seed_data.sql          # direct SQL (fastest)
# OR just start server and it auto-seeds on boot

# 3. Start
pnpm --filter @workspace/api-server run dev  # API on :3000
pnpm --filter @workspace/prospect-sa run dev # UI  on :5173
```

## Keys status
| Key | Status |
|---|---|
| `OPENAI_API_KEY` | ✅ pre-filled in `.env` |
| `APOLLO_API_KEY` + tokens | ✅ pre-filled |
| `EXPLORIUM_API_KEY` | ✅ pre-filled |
| `DATABASE_URL` | ⚠️ fill in `.env` |
| `ANTHROPIC_API_KEY` | ⚠️ fill in (Masaar + Claude enrichment) |
| `PERPLEXITY_API_KEY` | ⚠️ fill in (Signals, Lead Factory, Intel) |
| `GEMINI_API_KEY` | optional but recommended |

## Verify
```bash
curl http://localhost:3000/api/healthz   # {"status":"ok"}
curl http://localhost:3000/api/readyz    # {"status":"ok"} — DB connected
```
