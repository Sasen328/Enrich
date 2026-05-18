"""
OSINT Harvester — TheHarvester-style
Discovers emails, subdomains, and names via:
- DNS brute-force / common subdomains
- HTML meta mining
- Certificate Transparency (crt.sh)
- Google-dork simulation via search API stubs
- WHOIS-style data parsing
"""

import asyncio
import re
import json
from typing import Optional
from urllib.parse import quote

import httpx
import tldextract

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; Scout/1.0; +https://prospectsa.app)",
    "Accept": "application/json, text/html",
}

COMMON_SUBDOMAINS = [
    "www", "mail", "webmail", "smtp", "pop", "imap", "ftp",
    "portal", "app", "api", "admin", "login", "shop", "store",
    "crm", "erp", "hr", "careers", "jobs", "support", "help",
    "blog", "news", "media", "cdn", "static", "assets",
    "m", "mobile", "wap", "secure", "ssl", "vpn",
    "owa", "autodiscover", "exchange",
    "dev", "staging", "test", "beta", "demo",
    "ar", "en", "arabic", "english",
    "sa", "ksa", "riyadh", "jeddah", "dammam",
]

EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,10}\b")


async def _check_subdomain(client: httpx.AsyncClient, sub: str, domain: str) -> Optional[dict]:
    url = f"https://{sub}.{domain}"
    try:
        r = await client.get(url, timeout=6)
        if r.status_code < 500:
            return {
                "subdomain": f"{sub}.{domain}",
                "url": url,
                "status": r.status_code,
                "title": _extract_title(r.text),
            }
    except Exception:
        pass
    return None


def _extract_title(html: str) -> str:
    m = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
    return m.group(1).strip()[:120] if m else ""


async def _crtsh_subdomains(domain: str) -> list[str]:
    url = f"https://crt.sh/?q=%.{domain}&output=json"
    async with httpx.AsyncClient(headers=HEADERS, timeout=15, follow_redirects=True) as client:
        try:
            r = await client.get(url)
            data = r.json()
            subs = set()
            for entry in data:
                name = entry.get("name_value", "")
                for line in name.splitlines():
                    line = line.strip().lstrip("*.")
                    if line.endswith(f".{domain}") or line == domain:
                        subs.add(line)
            return sorted(subs)
        except Exception:
            return []


async def _rdap_whois(domain: str) -> dict:
    url = f"https://rdap.org/domain/{domain}"
    async with httpx.AsyncClient(headers=HEADERS, timeout=10, follow_redirects=True) as client:
        try:
            r = await client.get(url)
            data = r.json()
            result: dict = {}
            events = data.get("events", [])
            for ev in events:
                if ev.get("eventAction") == "registration":
                    result["registered"] = ev.get("eventDate", "")
                if ev.get("eventAction") == "expiration":
                    result["expires"] = ev.get("eventDate", "")
            entities = data.get("entities", [])
            registrar_names = []
            for ent in entities:
                vcard = ent.get("vcardArray", [])
                if vcard and len(vcard) > 1:
                    for item in vcard[1]:
                        if item[0] == "fn":
                            registrar_names.append(item[3])
            if registrar_names:
                result["registrar"] = registrar_names[0]
            nameservers = [ns.get("ldhName", "") for ns in data.get("nameservers", [])]
            if nameservers:
                result["nameservers"] = nameservers
            return result
        except Exception:
            return {}


async def _dns_mx(domain: str) -> list[str]:
    url = f"https://dns.google/resolve?name={domain}&type=MX"
    async with httpx.AsyncClient(timeout=8) as client:
        try:
            r = await client.get(url)
            data = r.json()
            answers = data.get("Answer", [])
            mx_records = []
            for ans in answers:
                if ans.get("type") == 15:
                    mx_data = ans.get("data", "")
                    parts = mx_data.split(" ", 1)
                    if len(parts) == 2:
                        mx_records.append(parts[1].rstrip("."))
            return mx_records
        except Exception:
            return []


def _infer_email_patterns(domain: str, names: list[str]) -> list[str]:
    patterns = []
    common_prefixes = ["info", "sales", "contact", "support", "hr", "careers",
                       "admin", "hello", "enquiries", "media", "pr",
                       "شركة", "استفسار"]
    for prefix in common_prefixes:
        patterns.append(f"{prefix}@{domain}")
    for name in names[:5]:
        clean = re.sub(r"[^\w\s]", "", name.lower()).split()
        if len(clean) >= 2:
            patterns.append(f"{clean[0]}.{clean[-1]}@{domain}")
            patterns.append(f"{clean[0][0]}{clean[-1]}@{domain}")
    return patterns


async def harvest_domain(
    domain: str,
    brute_subdomains: bool = True,
    max_subdomains: int = 30,
) -> dict:
    ext = tldextract.extract(domain)
    root_domain = f"{ext.domain}.{ext.suffix}"

    result: dict = {
        "domain": root_domain,
        "subdomains_crtsh": [],
        "subdomains_brute": [],
        "email_patterns": [],
        "mx_records": [],
        "whois": {},
        "errors": [],
    }

    crtsh_task = asyncio.create_task(_crtsh_subdomains(root_domain))
    mx_task = asyncio.create_task(_dns_mx(root_domain))
    rdap_task = asyncio.create_task(_rdap_whois(root_domain))

    result["subdomains_crtsh"] = await crtsh_task
    result["mx_records"] = await mx_task
    result["whois"] = await rdap_task

    if brute_subdomains:
        async with httpx.AsyncClient(
            headers=HEADERS,
            follow_redirects=True,
            verify=False,
        ) as client:
            sem = asyncio.Semaphore(10)

            async def guarded_check(sub: str) -> Optional[dict]:
                async with sem:
                    return await _check_subdomain(client, sub, root_domain)

            tasks = [guarded_check(sub) for sub in COMMON_SUBDOMAINS[:max_subdomains]]
            brute_results = await asyncio.gather(*tasks, return_exceptions=True)
            result["subdomains_brute"] = [
                r for r in brute_results
                if isinstance(r, dict) and r is not None
            ]

    result["email_patterns"] = _infer_email_patterns(root_domain, [])

    all_subs = set(result["subdomains_crtsh"])
    for s in result["subdomains_brute"]:
        if isinstance(s, dict):
            all_subs.add(s.get("subdomain", ""))
    result["all_discovered_subdomains"] = sorted(all_subs)[:100]

    return result
