"""
ProspectSA Python Scout Microservice
FastAPI service providing:
- Site intelligence scanning (contacts, tech, social)
- OSINT harvesting (subdomains, email patterns, WHOIS/DNS)
- Social presence scanning (Sherlock-style)
- Deep crawling (Scrapy-based)
- AI extraction (ScrapeGraphAI-style via Gemini)

Port: $PORT env var (defaults to 8001)
"""

import os
import asyncio
from typing import Optional, Any
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl, field_validator

from src.scrapers.site_intel import scrape_site_intel
from src.osint.harvester import harvest_domain
from src.osint.sherlock import scan_social_presence
from src.scrapers.deep_crawler import deep_crawl
from src.ai_extract import ai_extract_company, ai_extract_custom
from src.signals.news_monitor import fetch_company_news
from src.signals.sanctions_checker import check_sanctions
from src.signals.contracts_monitor import fetch_contract_signals
from src.signals.individual_monitor import fetch_individual_signals
from src.signals.regulatory_monitor import fetch_regulatory_signals

PORT = int(os.getenv("PORT", "8001"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"[Scout] Python microservice starting on port {PORT}")
    yield
    print("[Scout] Shutting down")


app = FastAPI(
    title="ProspectSA Scout",
    description="Saudi Arabia OSINT & web intelligence microservice",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request / Response Models ──────────────────────────────────────────────────

class SiteIntelRequest(BaseModel):
    url: str
    follow_subpages: bool = True
    timeout: int = 20

    @field_validator("url")
    @classmethod
    def ensure_scheme(cls, v: str) -> str:
        if not v.startswith("http"):
            return "https://" + v
        return v


class HarvestRequest(BaseModel):
    domain: str
    brute_subdomains: bool = True
    max_subdomains: int = 30

    @field_validator("domain")
    @classmethod
    def strip_scheme(cls, v: str) -> str:
        return v.replace("https://", "").replace("http://", "").split("/")[0]


class SherlockRequest(BaseModel):
    username: str
    platforms: Optional[list[str]] = None


class DeepCrawlRequest(BaseModel):
    url: str
    max_pages: int = 20

    @field_validator("url")
    @classmethod
    def ensure_scheme(cls, v: str) -> str:
        if not v.startswith("http"):
            return "https://" + v
        return v


class AIExtractRequest(BaseModel):
    url: str
    page_text: Optional[str] = None
    extraction_goal: Optional[str] = None
    output_schema: Optional[dict] = None
    auto_fetch: bool = True

    @field_validator("url")
    @classmethod
    def ensure_scheme(cls, v: str) -> str:
        if not v.startswith("http"):
            return "https://" + v
        return v


class FullScanRequest(BaseModel):
    url: str
    include_osint: bool = True
    include_ai: bool = True
    include_social: bool = False
    social_username: Optional[str] = None
    timeout: int = 25

    @field_validator("url")
    @classmethod
    def ensure_scheme(cls, v: str) -> str:
        if not v.startswith("http"):
            return "https://" + v
        return v


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "ProspectSA Scout",
        "version": "1.0.0",
        "port": PORT,
    }


@app.post("/scout/site-intel")
async def site_intel(req: SiteIntelRequest):
    """
    Full site intelligence scan:
    - Meta (title, description, OG)
    - Language detection (Arabic/English/bilingual)
    - Contact extraction (emails, phones)
    - Social media links
    - Tech stack fingerprinting
    - CR/VAT number detection
    - About & contact page follow
    """
    try:
        data = await scrape_site_intel(
            req.url,
            follow_about=req.follow_subpages,
            timeout=req.timeout,
        )
        return {"ok": True, "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/scout/osint/harvest")
async def osint_harvest(req: HarvestRequest):
    """
    Domain-level OSINT harvest (TheHarvester-style):
    - Certificate transparency subdomains (crt.sh)
    - Common subdomain brute-force
    - MX record discovery
    - RDAP/WHOIS data
    - Email pattern inference
    """
    try:
        data = await harvest_domain(
            req.domain,
            brute_subdomains=req.brute_subdomains,
            max_subdomains=req.max_subdomains,
        )
        return {"ok": True, "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/scout/osint/social")
async def social_presence(req: SherlockRequest):
    """
    Social presence scan (Sherlock-style):
    Checks 15+ platforms including Twitter/X, Instagram, LinkedIn,
    Facebook, YouTube, TikTok, Snapchat, GitHub, and more.
    """
    try:
        data = await scan_social_presence(req.username, req.platforms)
        return {"ok": True, "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/scout/crawl")
async def deep_crawl_endpoint(req: DeepCrawlRequest):
    """
    Deep recursive site crawl (Scrapy-based):
    Follows all internal links up to max_pages,
    extracting emails and phone numbers from every page.
    """
    try:
        data = await deep_crawl(req.url, max_pages=req.max_pages)
        return {"ok": True, "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/scout/ai-extract")
async def ai_extract_endpoint(req: AIExtractRequest):
    """
    AI-powered structured extraction (ScrapeGraphAI-style) via Gemini:
    - Auto-fetches page if page_text not provided
    - Extracts company schema by default
    - Supports custom extraction_goal + output_schema
    """
    page_text = req.page_text

    if not page_text and req.auto_fetch:
        site_data = await scrape_site_intel(req.url, follow_about=False)
        page_text = site_data.get("raw_text_snippet", "")
        if not page_text:
            raise HTTPException(status_code=400, detail="Could not fetch page content")

    if req.extraction_goal and req.output_schema:
        result = await ai_extract_custom(
            page_text or "",
            req.url,
            req.extraction_goal,
            req.output_schema,
        )
    else:
        result = await ai_extract_company(page_text or "", req.url)

    return {"ok": True, "data": result}


@app.post("/scout/full-scan")
async def full_scan(req: FullScanRequest):
    """
    Combined full intelligence scan — runs in parallel:
    1. Site intelligence (always)
    2. OSINT harvest (optional, default on)
    3. AI extraction (optional, default on)
    4. Social presence (optional, provide social_username)
    """
    from urllib.parse import urlparse
    import tldextract

    parsed = urlparse(req.url)
    domain = parsed.netloc or req.url.replace("https://", "").replace("http://", "").split("/")[0]
    ext = tldextract.extract(domain)
    root_domain = f"{ext.domain}.{ext.suffix}"

    tasks: dict[str, Any] = {}

    site_task = asyncio.create_task(
        scrape_site_intel(req.url, follow_about=True, timeout=req.timeout)
    )
    tasks["site"] = site_task

    if req.include_osint:
        tasks["osint"] = asyncio.create_task(
            harvest_domain(root_domain, brute_subdomains=True, max_subdomains=25)
        )

    if req.include_social and req.social_username:
        tasks["social"] = asyncio.create_task(
            scan_social_presence(req.social_username)
        )

    results: dict[str, Any] = {}
    for key, task in tasks.items():
        try:
            results[key] = await task
        except Exception as e:
            results[key] = {"error": str(e)}

    if req.include_ai:
        page_text = results.get("site", {}).get("raw_text_snippet", "")
        if page_text:
            try:
                results["ai_extract"] = await ai_extract_company(page_text, req.url)
            except Exception as e:
                results["ai_extract"] = {"error": str(e)}

    all_emails = set()
    all_emails.update(results.get("site", {}).get("emails", []))

    return {
        "ok": True,
        "url": req.url,
        "domain": root_domain,
        "all_emails": sorted(all_emails),
        "data": results,
    }


# ── Signal Intelligence Routes ─────────────────────────────────────────────────

class NewsSignalRequest(BaseModel):
    company_name: str
    company_name_ar: Optional[str] = None
    domain: Optional[str] = None
    max_articles: int = 30
    days_back: int = 90


class SanctionsRequest(BaseModel):
    name: str
    also_check: Optional[list[str]] = None


class ContractsRequest(BaseModel):
    company_name: str
    company_name_ar: Optional[str] = None


class FullSignalRequest(BaseModel):
    company_name: str
    company_name_ar: Optional[str] = None
    domain: Optional[str] = None
    include_news: bool = True
    include_sanctions: bool = True
    include_contracts: bool = True
    max_articles: int = 20


@app.post("/scout/signals/news")
async def signals_news(req: NewsSignalRequest):
    """
    Fetch trigger event news for a company from:
    - Google News RSS (Arabic + English Saudi editions)
    - Arab News, Saudi Gazette, Argaam, Mubasher RSS feeds
    Returns articles pre-classified as positive/negative with event types.
    """
    try:
        data = await fetch_company_news(
            req.company_name,
            company_name_ar=req.company_name_ar,
            domain=req.domain,
            max_articles=req.max_articles,
            days_back=req.days_back,
        )
        return {"ok": True, "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/scout/signals/sanctions")
async def signals_sanctions(req: SanctionsRequest):
    """
    Check company/person name against:
    - OFAC SDN List (US Treasury — 6000+ entries, updated daily)
    - UN Security Council Consolidated Sanctions List
    Returns hit records with list name, program, entity type.
    """
    try:
        data = await check_sanctions(req.name, also_check=req.also_check)
        return {"ok": True, "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/scout/signals/contracts")
async def signals_contracts(req: ContractsRequest):
    """
    Fetch government contract award signals for a company from:
    - Google News (contract/tender/project award keywords)
    - Saudi Gazette tenders RSS
    Positive buying signal: company won a contract = has budget.
    """
    try:
        data = await fetch_contract_signals(req.company_name, company_name_ar=req.company_name_ar)
        return {"ok": True, "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/scout/signals/full")
async def signals_full(req: FullSignalRequest):
    """
    Full signal intelligence scan — all streams in parallel:
    1. News monitoring (positive + negative events)
    2. Sanctions check (OFAC + UN)
    3. Government contracts (buying signals)

    Returns unified signal report with buying score and risk score.
    """
    tasks: dict[str, Any] = {}

    if req.include_news:
        tasks["news"] = asyncio.create_task(
            fetch_company_news(req.company_name, req.company_name_ar, req.domain, req.max_articles)
        )
    if req.include_sanctions:
        aliases = [req.company_name_ar] if req.company_name_ar else None
        tasks["sanctions"] = asyncio.create_task(
            check_sanctions(req.company_name, also_check=aliases)
        )
    if req.include_contracts:
        tasks["contracts"] = asyncio.create_task(
            fetch_contract_signals(req.company_name, req.company_name_ar)
        )

    results: dict[str, Any] = {}
    for key, task in tasks.items():
        try:
            results[key] = await task
        except Exception as e:
            results[key] = {"error": str(e)}

    # Compute summary scores
    news_data = results.get("news", {})
    sanctions_data = results.get("sanctions", {})
    contracts_data = results.get("contracts", {})

    positive_count = news_data.get("positive_count", 0) + contracts_data.get("contract_signals_found", 0)
    negative_count = news_data.get("negative_count", 0)
    is_sanctioned = sanctions_data.get("is_sanctioned", False)

    buying_score = min(10, positive_count * 2) if positive_count > 0 else 0
    risk_score = 10 if is_sanctioned else min(10, negative_count * 2)

    action = "monitor"
    if is_sanctioned or risk_score >= 9:
        action = "disqualify"
    elif risk_score >= 7:
        action = "hold"
    elif buying_score >= 6:
        action = "prioritize"

    return {
        "ok": True,
        "data": {
            "company": req.company_name,
            "buying_score": buying_score,
            "risk_score": risk_score,
            "is_sanctioned": is_sanctioned,
            "recommended_action": action,
            "positive_signals_count": positive_count,
            "negative_signals_count": negative_count,
            "streams": results,
        }
    }


# ── Individual Signal Intelligence Routes ──────────────────────────────────────

class IndividualSignalRequest(BaseModel):
    full_name: str
    full_name_ar: Optional[str] = None
    company_name: Optional[str] = None
    title: Optional[str] = None
    check_sanctions: bool = True
    max_articles: int = 30


class IndividualFullRequest(BaseModel):
    full_name: str
    full_name_ar: Optional[str] = None
    company_name: Optional[str] = None
    title: Optional[str] = None
    max_articles: int = 20


@app.post("/scout/signals/individual")
async def signals_individual(req: IndividualSignalRequest):
    """
    Monitor personal trigger events for a named individual:
    - Obituary / death / inheritance (liquidity signals)
    - Promotion / new appointment / job change
    - Executive compensation / bonus / stock vesting
    - Personal fraud / arrest / investigation (risk disqualifiers)

    Sources: Google News RSS (Arabic + English) + Saudi business media.
    """
    try:
        data = await fetch_individual_signals(
            req.full_name,
            full_name_ar=req.full_name_ar,
            company_name=req.company_name,
            title=req.title,
            max_articles=req.max_articles,
        )
        if req.check_sanctions:
            aliases = [req.full_name_ar] if req.full_name_ar else None
            sanctions_data = await check_sanctions(req.full_name, also_check=aliases)
            if sanctions_data.get("is_sanctioned"):
                data["risk_score"] = 10
                data["recommended_action"] = "disqualify"
                data["sanctions_hit"] = True
                data["sanctions_detail"] = sanctions_data
        return {"ok": True, "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/scout/signals/individual-full")
async def signals_individual_full(req: IndividualFullRequest):
    """
    Full individual intelligence: news signals + sanctions check in parallel.
    Returns unified buying/risk score with recommended sales action.
    """
    try:
        aliases = [req.full_name_ar] if req.full_name_ar else None
        news_data, sanctions_data = await asyncio.gather(
            fetch_individual_signals(req.full_name, full_name_ar=req.full_name_ar,
                                     company_name=req.company_name, title=req.title,
                                     max_articles=req.max_articles),
            check_sanctions(req.full_name, also_check=aliases),
        )
        is_sanctioned = sanctions_data.get("is_sanctioned", False)
        buying_score = news_data.get("buying_score", 0)
        risk_score = 10 if is_sanctioned else news_data.get("risk_score", 0)

        if is_sanctioned or risk_score >= 9:
            action = "disqualify"
        elif risk_score >= 7:
            action = "hold"
        elif buying_score >= 7:
            action = "prioritize"
        else:
            action = "monitor"

        return {
            "ok": True,
            "data": {
                "subject": req.full_name,
                "subject_ar": req.full_name_ar,
                "company": req.company_name,
                "buying_score": buying_score,
                "risk_score": risk_score,
                "is_sanctioned": is_sanctioned,
                "recommended_action": action,
                "liquidity_events_count": news_data.get("liquidity_events_count", 0),
                "positive_count": news_data.get("positive_count", 0),
                "negative_count": news_data.get("negative_count", 0),
                "event_type_summary": news_data.get("event_type_summary", {}),
                "top_signals": (news_data.get("liquidity_events") or []) + (news_data.get("articles") or [])[:5],
                "sanctions": sanctions_data,
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Saudi Regulatory Signal Routes ────────────────────────────────────────────

class RegulatorySignalRequest(BaseModel):
    company_name: str
    company_name_ar: Optional[str] = None
    include_tadawul: bool = True


@app.post("/scout/signals/regulatory")
async def signals_regulatory(req: RegulatorySignalRequest):
    """
    Fetch Saudi regulatory enforcement signals for a company:
    - CMA violations, fines, delistings
    - SAMA banking warnings, license revocations
    - ZATCA tax evasion, customs violations
    - Bankruptcy / NCBE insolvency filings
    - Maroof fraud complaints
    - Court judgments via Najiz keyword monitoring
    - Tadawul material disclosures (dividends, contracts, exec changes)

    All via targeted Google News RSS queries + Saudi business media.
    """
    try:
        data = await fetch_regulatory_signals(
            req.company_name,
            company_name_ar=req.company_name_ar,
            include_tadawul=req.include_tadawul,
        )
        return {"ok": True, "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
