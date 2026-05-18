-- ============================================================
-- ProspectSA — Complete Database Schema
-- Generated from live database on 2026-03-25
--
-- Run this file against a fresh PostgreSQL database to set up
-- all 17 tables, sequences, unique constraints, and foreign keys.
--
-- Usage:
--   psql $DATABASE_URL -f prospectsa_schema.sql
-- ============================================================


-- ============================================================
-- SEQUENCES (auto-increment counters for each table)
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS companies_id_seq;
CREATE SEQUENCE IF NOT EXISTS executives_id_seq;
CREATE SEQUENCE IF NOT EXISTS masar_companies_id_seq;
CREATE SEQUENCE IF NOT EXISTS masar_harvest_jobs_id_seq;
CREATE SEQUENCE IF NOT EXISTS builder_companies_id_seq;
CREATE SEQUENCE IF NOT EXISTS builder_jobs_id_seq;
CREATE SEQUENCE IF NOT EXISTS builder_custom_sources_id_seq;
CREATE SEQUENCE IF NOT EXISTS prospecting_jobs_id_seq;
CREATE SEQUENCE IF NOT EXISTS prospecting_results_id_seq;
CREATE SEQUENCE IF NOT EXISTS prospecting_sessions_id_seq;
CREATE SEQUENCE IF NOT EXISTS prospecting_exports_id_seq;
CREATE SEQUENCE IF NOT EXISTS jobs_id_seq;
CREATE SEQUENCE IF NOT EXISTS leads_id_seq;
CREATE SEQUENCE IF NOT EXISTS enrichment_reports_id_seq;
CREATE SEQUENCE IF NOT EXISTS research_jobs_id_seq;
CREATE SEQUENCE IF NOT EXISTS scrape_sessions_id_seq;
CREATE SEQUENCE IF NOT EXISTS templates_id_seq;


-- ============================================================
-- MESHBASE — Master read-only company + executive database
-- RULE: Never written to by Prospecting, Masaar, or Builder at runtime.
--       Only the manual "Seed to MeshBase" action in Builder writes here.
-- ============================================================

CREATE TABLE IF NOT EXISTS companies (
    id                  INTEGER     NOT NULL DEFAULT nextval('companies_id_seq') PRIMARY KEY,
    name_ar             TEXT,
    name_en             TEXT,
    industry            TEXT,
    sub_industry        TEXT,
    industry_ar         TEXT,
    city                TEXT,
    region              TEXT,
    country             TEXT        NOT NULL DEFAULT 'Saudi Arabia',
    website             TEXT,
    phone               TEXT,
    email               TEXT,
    contact_email       TEXT,
    description         TEXT,
    description_ar      TEXT,
    employee_count      TEXT,
    revenue             TEXT,
    profit              TEXT,
    growth_rate         TEXT,
    market_cap          TEXT,
    founding_year       INTEGER,
    logo_url            TEXT,
    ceo                 TEXT,
    founder             TEXT,
    address             TEXT,
    ai_insights         TEXT,
    cr_number           TEXT,
    capital_amount      TEXT,
    entity_type         TEXT,
    company_type        TEXT,
    owner_name          TEXT,
    owner_name_ar       TEXT,
    owner_title         TEXT,
    owner_phone         TEXT,
    owner_email         TEXT,
    owner_linkedin      TEXT,
    estimated_wealth    TEXT,
    shareholders        TEXT,
    key_executives      TEXT,
    market_positioning  TEXT,
    recent_news         TEXT,
    linkedin_url        TEXT,
    twitter_url         TEXT,
    enrichment_score    INTEGER,
    enrichment_status   TEXT,
    data_source         TEXT,
    tags                TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS executives (
    id                  INTEGER     NOT NULL DEFAULT nextval('executives_id_seq') PRIMARY KEY,
    company_id          INTEGER     REFERENCES companies(id),
    company_name        TEXT,
    name                TEXT,
    name_ar             TEXT,
    position            TEXT,
    position_ar         TEXT,
    email               TEXT,
    phone               TEXT,
    linkedin            TEXT,
    linkedin_url        TEXT,
    location            TEXT,
    biography           TEXT,
    education           TEXT,
    salary              TEXT,
    seniority_level     TEXT,
    department          TEXT,
    photo_url           TEXT,
    years_of_experience INTEGER,
    estimated_salary    INTEGER,
    skills              TEXT[],
    achievements        TEXT[],
    previous_companies  TEXT[],
    apollo_id           TEXT,
    is_featured         BOOLEAN     DEFAULT FALSE,
    enrichment_status   TEXT        DEFAULT 'pending',
    data_source         TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- MASAAR — CR lookup + AOA (Articles of Association) intelligence
-- Isolated in masar_companies; never touches the companies table.
-- ============================================================

CREATE TABLE IF NOT EXISTS masar_companies (
    id                       INTEGER     NOT NULL DEFAULT nextval('masar_companies_id_seq') PRIMARY KEY,
    name_en                  TEXT,
    name_ar                  TEXT,
    -- UNIQUE constraint: one record per CR number
    cr_number                TEXT        UNIQUE,
    legal_form               TEXT,
    legal_form_ar            TEXT,
    city                     TEXT,
    city_ar                  TEXT,
    region                   TEXT,
    paid_up_capital          TEXT,
    authorized_capital       TEXT,
    founding_date            TEXT,
    founding_year            TEXT,
    registration_date        TEXT,
    expiry_date              TEXT,
    authorized_signatory     TEXT,
    -- JSON arrays: [{nameEn, nameAr, nationalId, ownershipPct, nationality}]
    shareholders             JSONB       DEFAULT '[]',
    -- JSON arrays: [{nameEn, nameAr, role, nationalId}]
    board_of_directors       JSONB       DEFAULT '[]',
    -- JSON arrays: [{nameEn, nameAr, title, nationalId, powers}]
    management               JSONB       DEFAULT '[]',
    main_activity            TEXT,
    main_activity_ar         TEXT,
    registration_status      TEXT,
    source                   TEXT        NOT NULL DEFAULT 'open-data',
    source_url               TEXT,
    enrichment_status        TEXT        DEFAULT 'pending',
    website                  TEXT,
    phone                    TEXT,
    email                    TEXT,
    employee_count           TEXT,
    revenue_estimate         TEXT,
    revenue_rationale        TEXT,
    -- JSON array: [{title, date, source}]
    news_headlines           JSONB       DEFAULT '[]',
    enrichment_data          JSONB       DEFAULT '{}',
    analysis_en              TEXT,
    analysis_ar              TEXT,
    analysis_data            JSONB       DEFAULT '{}',
    capital_distribution     TEXT,
    profit_distribution_rules TEXT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    enriched_at              TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS masar_harvest_jobs (
    id                  INTEGER     NOT NULL DEFAULT nextval('masar_harvest_jobs_id_seq') PRIMARY KEY,
    -- UNIQUE: one active record per job ID
    job_id              TEXT        NOT NULL UNIQUE,
    keyword             TEXT        NOT NULL,
    source              TEXT        NOT NULL,
    status              TEXT        NOT NULL DEFAULT 'running',
    companies_found     INTEGER     DEFAULT 0,
    companies_enriched  INTEGER     DEFAULT 0,
    error_message       TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at        TIMESTAMPTZ
);


-- ============================================================
-- DATABASE BUILDER — Staging area for agentic company harvesting
-- Companies are staged here, then manually pushed to MeshBase.
-- ============================================================

CREATE TABLE IF NOT EXISTS builder_companies (
    id                  INTEGER     NOT NULL DEFAULT nextval('builder_companies_id_seq') PRIMARY KEY,
    job_id              TEXT        NOT NULL,
    source_id           TEXT        NOT NULL,
    source_name         TEXT,
    name_ar             TEXT,
    name_en             TEXT,
    industry            TEXT,
    industry_ar         TEXT,
    city                TEXT,
    region              TEXT,
    country             TEXT        NOT NULL DEFAULT 'Saudi Arabia',
    website             TEXT,
    phone               TEXT,
    email               TEXT,
    description         TEXT,
    description_ar      TEXT,
    employee_count      INTEGER,
    revenue             TEXT,
    founding_year       INTEGER,
    cr_number           TEXT,
    capital_amount      TEXT,
    entity_type         TEXT,
    company_type        TEXT,
    owner_name          TEXT,
    owner_name_ar       TEXT,
    owner_title         TEXT,
    owner_phone         TEXT,
    owner_email         TEXT,
    owner_linkedin      TEXT,
    estimated_wealth    TEXT,
    shareholders        TEXT,
    key_executives      TEXT,
    market_positioning  TEXT,
    recent_news         TEXT,
    linkedin_url        TEXT,
    enrichment_score    INTEGER,
    enrichment_status   TEXT,
    -- Deduplication flag; set during dedup run; records with TRUE are deleted
    is_duplicate        BOOLEAN     NOT NULL DEFAULT FALSE,
    is_validated        BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS builder_jobs (
    id                   INTEGER     NOT NULL DEFAULT nextval('builder_jobs_id_seq') PRIMARY KEY,
    legacy_job_id        TEXT,
    status               TEXT        NOT NULL DEFAULT 'pending',
    source_index         INTEGER     NOT NULL DEFAULT 0,
    log                  TEXT,
    companies_found      INTEGER     NOT NULL DEFAULT 0,
    companies_added      INTEGER     NOT NULL DEFAULT 0,
    companies_duplicate  INTEGER     NOT NULL DEFAULT 0,
    started_at           TIMESTAMPTZ,
    completed_at         TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS builder_custom_sources (
    id                   INTEGER   NOT NULL DEFAULT nextval('builder_custom_sources_id_seq') PRIMARY KEY,
    name                 TEXT      NOT NULL,
    name_ar              TEXT,
    url                  TEXT      NOT NULL,
    -- Category: 'government' | 'directory' | 'chamber' | 'financial' | 'other'
    category             TEXT      NOT NULL DEFAULT 'other',
    description          TEXT,
    estimated_companies  INTEGER   DEFAULT 0,
    created_at           TIMESTAMP NOT NULL DEFAULT NOW()
);


-- ============================================================
-- SMART PROSPECTING — Paste a URL, extract + enrich companies
-- ============================================================

CREATE TABLE IF NOT EXISTS prospecting_jobs (
    id                    INTEGER     NOT NULL DEFAULT nextval('prospecting_jobs_id_seq') PRIMARY KEY,
    target_url            TEXT        NOT NULL,
    status                TEXT        NOT NULL DEFAULT 'pending',
    progress              INTEGER     DEFAULT 0,
    result_count          INTEGER     DEFAULT 0,
    total_companies_found INTEGER     DEFAULT 0,
    total_enriched        INTEGER     DEFAULT 0,
    error_message         TEXT,
    error                 TEXT,
    -- Raw scan result from Phase 1 (JSON)
    scan_result           JSONB,
    -- Structured summary: {totalPages, dataType, sampleCompanies, categories, ...}
    scan_summary          JSONB,
    pages_scanned         INTEGER     DEFAULT 0,
    -- User settings: {maxPages, extractionFields, filters, enrichmentDepth, userAnswers}
    settings              JSONB,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at          TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS prospecting_results (
    id                   INTEGER     NOT NULL DEFAULT nextval('prospecting_results_id_seq') PRIMARY KEY,
    job_id               INTEGER     NOT NULL,
    -- Extracted company data as free-form JSON (schema varies by source site)
    company_data         JSONB,
    enrichment_status    TEXT        DEFAULT 'pending',
    source_url           TEXT,
    enrichment_report_id TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prospecting_sessions (
    id                      INTEGER     NOT NULL DEFAULT nextval('prospecting_sessions_id_seq') PRIMARY KEY,
    -- UNIQUE: one session per session_id
    session_id              TEXT        NOT NULL UNIQUE,
    url                     TEXT        NOT NULL,
    website_type            TEXT,
    detected_categories     TEXT,
    estimated_company_count INTEGER,
    pages_found             INTEGER     NOT NULL DEFAULT 0,
    sample_companies        TEXT,
    language                TEXT,
    status                  TEXT        NOT NULL DEFAULT 'pending',
    companies_found         INTEGER     NOT NULL DEFAULT 0,
    enrichment_status       TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prospecting_exports (
    id           INTEGER     NOT NULL DEFAULT nextval('prospecting_exports_id_seq') PRIMARY KEY,
    job_id       INTEGER     NOT NULL,
    format       TEXT        NOT NULL,
    filename     TEXT        NOT NULL,
    record_count INTEGER     DEFAULT 0,
    file_size    INTEGER     DEFAULT 0,
    target_url   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- SHARED INFRASTRUCTURE
-- ============================================================

-- Master job tracker (used by both Prospecting and Builder)
CREATE TABLE IF NOT EXISTS jobs (
    id                   INTEGER     NOT NULL DEFAULT nextval('jobs_id_seq') PRIMARY KEY,
    -- UNIQUE job identifier (UUID)
    job_id               TEXT        NOT NULL UNIQUE,
    -- 'prospecting' | 'builder' | 'enrichment'
    type                 TEXT        NOT NULL,
    -- 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
    status               TEXT        NOT NULL DEFAULT 'pending',
    phase                TEXT,
    session_id           TEXT,
    source_ids           TEXT,
    sources_total        INTEGER     NOT NULL DEFAULT 0,
    sources_completed    INTEGER     NOT NULL DEFAULT 0,
    companies_harvested  INTEGER     NOT NULL DEFAULT 0,
    companies_enriched   INTEGER     NOT NULL DEFAULT 0,
    companies_duplicated INTEGER     NOT NULL DEFAULT 0,
    progress             INTEGER     NOT NULL DEFAULT 0,
    total                INTEGER     NOT NULL DEFAULT 0,
    companies_processed  INTEGER     NOT NULL DEFAULT 0,
    -- JSON: per-source agent status map
    agent_statuses       TEXT,
    error_message        TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Leads CRM
CREATE TABLE IF NOT EXISTS leads (
    id            INTEGER     NOT NULL DEFAULT nextval('leads_id_seq') PRIMARY KEY,
    company_id    INTEGER,
    first_name    TEXT,
    last_name     TEXT,
    first_name_ar TEXT,
    last_name_ar  TEXT,
    title         TEXT,
    title_ar      TEXT,
    email         TEXT,
    phone         TEXT,
    linkedin_url  TEXT,
    twitter_url   TEXT,
    department    TEXT,
    seniority     TEXT,
    notes         TEXT,
    -- 'new' | 'contacted' | 'qualified' | 'won' | 'lost'
    status        TEXT        NOT NULL DEFAULT 'new',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- AI enrichment report cache
CREATE TABLE IF NOT EXISTS enrichment_reports (
    id               INTEGER     NOT NULL DEFAULT nextval('enrichment_reports_id_seq') PRIMARY KEY,
    -- 'company' | 'executive' | 'lead'
    type             TEXT        NOT NULL,
    subject_name     TEXT        NOT NULL,
    subject_company  TEXT,
    confidence_score TEXT,
    -- Full structured enrichment data (JSON)
    report_data      JSONB,
    -- Source citations [{title, confidence, url, type}]
    sources          JSONB,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ORC AI research engine jobs
CREATE TABLE IF NOT EXISTS research_jobs (
    id            INTEGER     NOT NULL DEFAULT nextval('research_jobs_id_seq') PRIMARY KEY,
    query         TEXT        NOT NULL,
    -- 'pending' | 'running' | 'completed' | 'failed'
    status        TEXT        NOT NULL DEFAULT 'pending',
    -- Final research report JSON
    report        JSONB,
    -- Source citations JSON
    sources       JSONB,
    -- Individual research findings JSON
    findings      JSONB,
    -- Per-agent results JSON
    agent_results JSONB,
    progress      INTEGER     DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Web scrape sessions (for ORC engine knowledge base)
CREATE TABLE IF NOT EXISTS scrape_sessions (
    id             INTEGER     NOT NULL DEFAULT nextval('scrape_sessions_id_seq') PRIMARY KEY,
    -- Array of URLs that were scraped
    urls           JSONB,
    -- Structured knowledge base extracted from pages
    knowledge_base JSONB,
    -- Chat history with AI
    chat_history   JSONB,
    summary        TEXT,
    progress       INTEGER     DEFAULT 0,
    -- 'pending' | 'running' | 'completed' | 'failed'
    status         TEXT        NOT NULL DEFAULT 'pending',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Saved prospecting / builder configuration templates
CREATE TABLE IF NOT EXISTS templates (
    id          INTEGER   NOT NULL DEFAULT nextval('templates_id_seq') PRIMARY KEY,
    name        TEXT      NOT NULL,
    description TEXT,
    category    TEXT,
    -- Template configuration JSON
    config      JSONB,
    is_builtin  BOOLEAN   DEFAULT FALSE,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);


-- ============================================================
-- INDEXES (for search performance)
-- ============================================================

-- MeshBase full-text search
CREATE INDEX IF NOT EXISTS idx_companies_name_en   ON companies (name_en);
CREATE INDEX IF NOT EXISTS idx_companies_name_ar   ON companies (name_ar);
CREATE INDEX IF NOT EXISTS idx_companies_industry  ON companies (industry);
CREATE INDEX IF NOT EXISTS idx_companies_city      ON companies (city);
CREATE INDEX IF NOT EXISTS idx_companies_region    ON companies (region);
CREATE INDEX IF NOT EXISTS idx_companies_cr_number ON companies (cr_number);

-- Executives search
CREATE INDEX IF NOT EXISTS idx_executives_company_id ON executives (company_id);
CREATE INDEX IF NOT EXISTS idx_executives_name        ON executives (name);

-- Masar search
CREATE INDEX IF NOT EXISTS idx_masar_companies_name_en   ON masar_companies (name_en);
CREATE INDEX IF NOT EXISTS idx_masar_companies_name_ar   ON masar_companies (name_ar);
CREATE INDEX IF NOT EXISTS idx_masar_companies_city      ON masar_companies (city);
CREATE INDEX IF NOT EXISTS idx_masar_companies_source    ON masar_companies (source);
CREATE INDEX IF NOT EXISTS idx_masar_companies_status    ON masar_companies (enrichment_status);

-- Builder search
CREATE INDEX IF NOT EXISTS idx_builder_companies_job_id    ON builder_companies (job_id);
CREATE INDEX IF NOT EXISTS idx_builder_companies_source_id ON builder_companies (source_id);
CREATE INDEX IF NOT EXISTS idx_builder_companies_name_en   ON builder_companies (name_en);
CREATE INDEX IF NOT EXISTS idx_builder_companies_is_dup    ON builder_companies (is_duplicate);

-- Jobs lookup
CREATE INDEX IF NOT EXISTS idx_jobs_status    ON jobs (status);
CREATE INDEX IF NOT EXISTS idx_jobs_type      ON jobs (type);

-- Prospecting lookup
CREATE INDEX IF NOT EXISTS idx_prospecting_results_job_id ON prospecting_results (job_id);
CREATE INDEX IF NOT EXISTS idx_prospecting_jobs_status    ON prospecting_jobs (status);

-- Leads lookup
CREATE INDEX IF NOT EXISTS idx_leads_status     ON leads (status);
CREATE INDEX IF NOT EXISTS idx_leads_company_id ON leads (company_id);


-- ============================================================
-- VERIFICATION QUERY
-- Run this after applying the schema to confirm all tables exist:
--
-- SELECT table_name, 
--        (SELECT COUNT(*) FROM information_schema.columns 
--         WHERE table_name = t.table_name AND table_schema = 'public') AS column_count
-- FROM information_schema.tables t
-- WHERE table_schema = 'public'
-- ORDER BY table_name;
-- ============================================================
