"""
Saudi Regulatory Monitor
Tracks enforcement actions, violations, and official disclosures from:
  - CMA (Capital Market Authority) — violations, fines, suspensions
  - SAMA (Saudi Central Bank) — banking violations, warnings
  - ZATCA (Zakat, Tax, Customs) — tax evasion, customs violations
  - NCBE / Bankruptcy Court — insolvency filings
  - Maroof — consumer fraud complaints
  - Tadawul / Saudi Exchange — listed company material disclosures
  - MISA — foreign investment violations

All via Google News RSS + direct site RSS where available (no auth).
"""

import asyncio
import hashlib
import re
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import quote_plus

import feedparser
import httpx
from dateutil import parser as dateparser

GOOGLE_NEWS_EN = "https://news.google.com/rss/search?q={query}&hl=en&gl=SA&ceid=SA:en"
GOOGLE_NEWS_AR = "https://news.google.com/rss/search?q={query}&hl=ar&gl=SA&ceid=SA:ar"

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; ProspectSA-Scout/1.0)"}

# ── Regulatory RSS sources ─────────────────────────────────────────────────────

REGULATORY_FEEDS = [
    {"name": "Argaam Tadawul",  "url": "https://www.argaam.com/ar/article/rss",     "lang": "ar"},
    {"name": "Al Eqtisadiah",   "url": "https://www.aleqt.com/rss",                 "lang": "ar"},
    {"name": "Saudi Gazette",   "url": "https://saudigazette.com.sa/rss",           "lang": "en"},
    {"name": "Arab News Biz",   "url": "https://www.arabnews.com/taxonomy/term/2/feed", "lang": "en"},
    {"name": "CNBC Arabia",     "url": "https://www.cnbcarabia.com/rss",            "lang": "ar"},
    {"name": "Mubasher",        "url": "https://mubasher.info/feed",                "lang": "ar"},
]

# ── Regulatory body news queries ───────────────────────────────────────────────

REGULATORY_QUERIES = {
    "cma": {
        "en": '"{company}" CMA "Capital Market Authority" OR violation OR fine OR suspend OR delist',
        "ar": '"{company_ar}" هيئة السوق المالية OR مخالفة OR غرامة OR إيقاف OR شطب',
        "risk_score": 8,
        "event_type": "cma_action",
        "label": "CMA Action",
    },
    "sama": {
        "en": '"{company}" SAMA "Saudi Central Bank" OR violation OR fine OR license OR warning',
        "ar": '"{company_ar}" البنك المركزي السعودي OR مخالفة OR غرامة OR ترخيص OR تحذير',
        "risk_score": 8,
        "event_type": "sama_action",
        "label": "SAMA Action",
    },
    "zatca": {
        "en": '"{company}" ZATCA tax evasion OR customs OR VAT violation OR fine',
        "ar": '"{company_ar}" زكاة ضرائب OR تهرب ضريبي OR جمارك OR مخالفة',
        "risk_score": 7,
        "event_type": "zatca_action",
        "label": "ZATCA/Tax Action",
    },
    "bankruptcy": {
        "en": '"{company}" bankruptcy OR insolvent OR liquidation OR creditors OR "financial restructuring"',
        "ar": '"{company_ar}" إفلاس OR تصفية OR إعسار OR دائنين OR "إعادة هيكلة مالية"',
        "risk_score": 10,
        "event_type": "bankruptcy",
        "label": "Bankruptcy/Insolvency",
    },
    "maroof": {
        "en": '"{company}" Maroof OR fraud OR "consumer complaint" OR scam OR blacklist',
        "ar": '"{company_ar}" معروف OR احتيال OR شكاوى المستهلكين OR نصب OR قائمة سوداء',
        "risk_score": 8,
        "event_type": "fraud_complaint",
        "label": "Fraud/Maroof Complaint",
    },
    "court": {
        "en": '"{company}" court OR lawsuit OR judgment OR "najiz" OR "commercial court"',
        "ar": '"{company_ar}" محكمة OR دعوى OR حكم OR نجيز OR "المحكمة التجارية"',
        "risk_score": 7,
        "event_type": "court_action",
        "label": "Court Judgment",
    },
    "misa": {
        "en": '"{company}" MISA OR "investment violation" OR "foreign investment" OR "operating license"',
        "ar": '"{company_ar}" مساف OR "مخالفة استثمار" OR "ترخيص تشغيل"',
        "risk_score": 7,
        "event_type": "misa_action",
        "label": "MISA Action",
    },
}

# ── Tadawul disclosure queries (positive signals for listed companies) ─────────

TADAWUL_QUERIES = {
    "material_event": {
        "en": '"{company}" Tadawul disclosure OR "material event" OR "significant announcement" site:tadawul.com.sa OR site:argaam.com',
        "ar": '"{company_ar}" تداول إفصاح OR "حدث جوهري" OR "إعلان هام"',
        "buying_score": 7,
        "event_type": "tadawul_disclosure",
        "label": "Tadawul Material Disclosure",
    },
    "dividend": {
        "en": '"{company}" dividend declared OR distribution OR "earnings per share" OR profit',
        "ar": '"{company_ar}" توزيع أرباح OR أرباح نقدية OR "ربح السهم"',
        "buying_score": 6,
        "event_type": "dividend",
        "label": "Dividend/Profit Distribution",
    },
    "ipo_rights": {
        "en": '"{company}" rights issue OR capital increase OR IPO OR listing OR "share offering"',
        "ar": '"{company_ar}" حقوق الاكتتاب OR زيادة رأس المال OR طرح عام OR اكتتاب',
        "buying_score": 8,
        "event_type": "ipo",
        "label": "IPO/Capital Event",
    },
    "contract_award": {
        "en": '"{company}" "contract awarded" OR "project awarded" OR "agreement signed" OR "MOU"',
        "ar": '"{company_ar}" ترسية عقد OR "توقيع اتفاقية" OR "مذكرة تفاهم" OR مشروع',
        "buying_score": 8,
        "event_type": "contract",
        "label": "Contract/MOU Award",
    },
    "executive_change": {
        "en": '"{company}" CEO appointed OR chairman OR board change OR executive departure',
        "ar": '"{company_ar}" تعيين رئيس تنفيذي OR تغيير مجلس OR استقالة تنفيذي',
        "buying_score": 4,
        "event_type": "executive",
        "label": "Executive/Board Change",
    },
}


def _parse_date(entry) -> Optional[str]:
    for attr in ["published", "updated", "created"]:
        val = getattr(entry, attr, None)
        if val:
            try:
                dt = dateparser.parse(val)
                return dt.isoformat() if dt else None
            except Exception:
                return val
    return None


def _article_id(url: str) -> str:
    return hashlib.md5(url.encode()).hexdigest()[:12]


async def _fetch_rss(url: str, timeout: int = 12) -> list:
    try:
        async with httpx.AsyncClient(headers=HEADERS, timeout=timeout, follow_redirects=True) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            feed = feedparser.parse(resp.text)
            return feed.entries
    except Exception:
        return []


def _entry_matches_company(entry, company_terms: list[str]) -> bool:
    text = " ".join([
        getattr(entry, "title", ""),
        getattr(entry, "summary", ""),
    ]).lower()
    return any(term.lower() in text for term in company_terms)


async def _query_google_news(query_en: str, query_ar: str) -> list[dict]:
    en_url = GOOGLE_NEWS_EN.format(query=quote_plus(query_en))
    ar_url = GOOGLE_NEWS_AR.format(query=quote_plus(query_ar))
    results = await asyncio.gather(_fetch_rss(en_url), _fetch_rss(ar_url), return_exceptions=True)
    entries = []
    for r in results:
        if isinstance(r, list):
            entries.extend(r)
    return entries


async def fetch_regulatory_signals(
    company_name: str,
    company_name_ar: Optional[str] = None,
    include_tadawul: bool = True,
) -> dict:
    """
    Fetch regulatory enforcement actions + Tadawul disclosures for a company.
    Returns risk signals (CMA/SAMA/ZATCA/bankruptcy/court) and positive signals (Tadawul).
    """
    ar = company_name_ar or company_name

    all_risk_signals = []
    all_positive_signals = []
    seen_ids = set()

    # ── Build all regulatory queries in parallel ───────────────────────────────
    regulatory_tasks = []
    for reg_key, reg_cfg in REGULATORY_QUERIES.items():
        q_en = reg_cfg["en"].replace("{company}", company_name).replace("{company_ar}", ar)
        q_ar = reg_cfg["ar"].replace("{company}", company_name).replace("{company_ar}", ar)
        regulatory_tasks.append((reg_key, reg_cfg, _query_google_news(q_en, q_ar)))

    tadawul_tasks = []
    if include_tadawul:
        for td_key, td_cfg in TADAWUL_QUERIES.items():
            q_en = td_cfg["en"].replace("{company}", company_name).replace("{company_ar}", ar)
            q_ar = td_cfg["ar"].replace("{company}", company_name).replace("{company_ar}", ar)
            tadawul_tasks.append((td_key, td_cfg, _query_google_news(q_en, q_ar)))

    static_task = asyncio.gather(*[_fetch_rss(f["url"]) for f in REGULATORY_FEEDS], return_exceptions=True)

    # Run all in parallel
    reg_results = await asyncio.gather(*[t[2] for t in regulatory_tasks], return_exceptions=True)
    td_results = await asyncio.gather(*[t[2] for t in tadawul_tasks], return_exceptions=True) if tadawul_tasks else []
    static_results = await static_task

    # ── Process regulatory results ─────────────────────────────────────────────
    for (reg_key, reg_cfg, _), entries in zip(regulatory_tasks, reg_results):
        if isinstance(entries, Exception) or not isinstance(entries, list):
            continue
        for entry in entries:
            url = getattr(entry, "link", "") or getattr(entry, "id", "")
            art_id = _article_id(url)
            if art_id in seen_ids:
                continue
            seen_ids.add(art_id)
            title = getattr(entry, "title", "").strip()
            summary = re.sub(r"<[^>]+>", " ", getattr(entry, "summary", "") or "").strip()[:500]
            all_risk_signals.append({
                "id": art_id,
                "source": reg_key.upper(),
                "regulator": reg_cfg["label"],
                "title": title,
                "summary": summary,
                "url": url,
                "published": _parse_date(entry),
                "event_type": reg_cfg["event_type"],
                "risk_score": reg_cfg["risk_score"],
                "category": "negative",
            })

    # ── Process Tadawul results ────────────────────────────────────────────────
    for (td_key, td_cfg, _), entries in zip(tadawul_tasks, td_results):
        if isinstance(entries, Exception) or not isinstance(entries, list):
            continue
        for entry in entries:
            url = getattr(entry, "link", "") or getattr(entry, "id", "")
            art_id = _article_id(url)
            if art_id in seen_ids:
                continue
            seen_ids.add(art_id)
            title = getattr(entry, "title", "").strip()
            summary = re.sub(r"<[^>]+>", " ", getattr(entry, "summary", "") or "").strip()[:500]
            all_positive_signals.append({
                "id": art_id,
                "source": "Tadawul",
                "disclosure_type": td_cfg["label"],
                "title": title,
                "summary": summary,
                "url": url,
                "published": _parse_date(entry),
                "event_type": td_cfg["event_type"],
                "buying_score": td_cfg["buying_score"],
                "category": "positive",
            })

    # ── Process static feed results filtered by company name ──────────────────
    company_terms = [company_name] + ([company_name_ar] if company_name_ar else [])
    for i, entries in enumerate(static_results):
        if isinstance(entries, Exception) or not isinstance(entries, list):
            continue
        feed_name = REGULATORY_FEEDS[i]["name"]
        for entry in entries:
            if not _entry_matches_company(entry, company_terms):
                continue
            url = getattr(entry, "link", "") or getattr(entry, "id", "")
            art_id = _article_id(url)
            if art_id in seen_ids:
                continue
            seen_ids.add(art_id)
            title = getattr(entry, "title", "").strip()
            summary = re.sub(r"<[^>]+>", " ", getattr(entry, "summary", "") or "").strip()[:400]
            # Basic classify
            text_lower = (title + " " + summary).lower()
            is_neg = any(kw in text_lower for kw in ["مخالفة", "غرامة", "إفلاس", "قضية", "تحقيق", "violation", "fine", "fraud", "bankrupt", "court", "lawsuit"])
            is_pos = any(kw in text_lower for kw in ["عقد", "توزيع", "اتفاق", "توسع", "contract", "dividend", "deal", "expansion", "profit"])
            if is_neg:
                all_risk_signals.append({
                    "id": art_id,
                    "source": feed_name,
                    "regulator": "News",
                    "title": title,
                    "summary": summary,
                    "url": url,
                    "published": _parse_date(entry),
                    "event_type": "news_regulatory",
                    "risk_score": 6,
                    "category": "negative",
                })
            elif is_pos:
                all_positive_signals.append({
                    "id": art_id,
                    "source": feed_name,
                    "disclosure_type": "News",
                    "title": title,
                    "summary": summary,
                    "url": url,
                    "published": _parse_date(entry),
                    "event_type": "news_positive",
                    "buying_score": 5,
                    "category": "positive",
                })

    # Sort and limit
    all_risk_signals.sort(key=lambda a: a.get("risk_score", 0), reverse=True)
    all_positive_signals.sort(key=lambda a: a.get("buying_score", 0), reverse=True)

    max_risk_score = max((s["risk_score"] for s in all_risk_signals), default=0)
    max_buying_score = max((s["buying_score"] for s in all_positive_signals), default=0)

    if max_risk_score >= 9:
        recommended_action = "disqualify"
    elif max_risk_score >= 7:
        recommended_action = "hold"
    elif max_buying_score >= 7:
        recommended_action = "prioritize"
    else:
        recommended_action = "monitor"

    return {
        "company": company_name,
        "company_ar": company_name_ar,
        "risk_signals_found": len(all_risk_signals),
        "positive_signals_found": len(all_positive_signals),
        "max_risk_score": max_risk_score,
        "max_buying_score": max_buying_score,
        "recommended_action": recommended_action,
        "risk_signals": all_risk_signals[:30],
        "positive_signals": all_positive_signals[:30],
    }
