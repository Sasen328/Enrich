-- Drop the SA Market engine tables. The engine surface (route, pages, nav,
-- swarm agent, lead source) was removed; these tables are now orphaned.
-- Applied in filename order by start.sh's psql safety-net (ON_ERROR_STOP=0).
DROP TABLE IF EXISTS sa_market_shareholders CASCADE;
DROP TABLE IF EXISTS sa_market_executives CASCADE;
DROP TABLE IF EXISTS sa_market_profiles CASCADE;
