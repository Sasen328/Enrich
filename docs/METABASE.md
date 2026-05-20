# Metabase — Analytics on ProspectSA

Metabase is wired into `docker-compose.yml` as an **optional service** behind
the `bi` profile so it only starts when you explicitly ask for it.

## Start it

```bash
docker compose --profile bi up -d metabase
```

First boot takes ~60-90 seconds (Metabase initialises its internal schema in
the `metabase` Postgres database that the init script created on first boot).

## Open it

Visit **http://localhost:3001** in your browser (Codespaces: forward port
3001 in the Ports tab and click the globe).

First-time setup:

1. Set up admin account — use any email + password.
2. **Skip** "I'll add my data later" — instead add the ProspectSA DB now.
3. Database connection (use these exact values — both containers share the
   same Docker network):

   | Field | Value |
   |---|---|
   | **Database type** | PostgreSQL |
   | **Display name** | ProspectSA |
   | **Host** | `db` |
   | **Port** | `5432` |
   | **Database name** | `prospectsa` |
   | **Username** | `prospectsa` |
   | **Password** | whatever `POSTGRES_PASSWORD` is in `.env` (defaults to `prospectsa_secret`) |

4. Click **Connect**. Metabase scans the schema (~10 seconds). Done.

## What to query first

Useful starter dashboards:

- **Companies by industry** — `SELECT industry, COUNT(*) FROM companies GROUP BY industry ORDER BY 2 DESC`
- **Lead pipeline** — `SELECT status, COUNT(*) FROM leads GROUP BY status`
- **Lead Factory throughput** — `SELECT date_trunc('day', created_at) day, COUNT(*) FROM lead_factory_jobs GROUP BY 1 ORDER BY 1 DESC`
- **Signals last 90 days** — `SELECT signal_type, COUNT(*) FROM company_signals WHERE created_at > now() - INTERVAL '90 days' GROUP BY 1`
- **Companies enriched today** — `SELECT * FROM companies WHERE updated_at::date = CURRENT_DATE`

## Stop Metabase without stopping the app

```bash
docker compose stop metabase
```

## Tear down completely

```bash
docker compose --profile bi down
docker volume rm prospectsa_full_metabase_data    # wipes Metabase config
```

## Notes

- Metabase's own internal data lives in the `metabase` Postgres database
  (separate from `prospectsa`), so the app schema stays clean.
- Metabase runs on container port 3000 internally but is exposed on host
  port 3001 to avoid the conflict with the app.
- The `metabase_data` volume only stores plugins / GeoJSON caches. The
  important state (questions, dashboards, users) is in the Postgres
  `metabase` database, so backups are automatic when you back up Postgres.
- Read-only access for Metabase is **not configured** — it uses the main
  `prospectsa` user. If you want read-only, create a separate Postgres
  user with `SELECT` grants and point Metabase at that instead.
