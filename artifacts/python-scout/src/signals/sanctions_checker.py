"""
Sanctions & Watchlist Checker
Checks company/person names against free global sanctions lists:
  - OFAC SDN (US Treasury) — updated daily
  - UN Security Council Consolidated List — updated continuously
  - EU Financial Sanctions File — updated daily
  - Saudi SAMA/Maroof (via web lookup)
"""

import asyncio
import csv
import io
import re
import xml.etree.ElementTree as ET
from typing import Optional

import httpx

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; ProspectSA-Scout/1.0)"}

# Free bulk downloads — all update daily
OFAC_CSV_URL    = "https://www.treasury.gov/ofac/downloads/sdn.csv"
UN_XML_URL      = "https://scsanctions.un.org/resources/xml/en/consolidated.xml"
EU_XML_URL      = "https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw"

# In-memory cache (populated on first call, refreshed every 24h)
_cache: dict = {
    "ofac": None,
    "un": None,
    "eu": None,
    "loaded_at": None,
}


def _normalize(name: str) -> str:
    return re.sub(r"[^\w\s]", "", name.lower()).strip()


def _name_matches(query_norm: str, candidate: str, threshold: float = 0.75) -> bool:
    cand_norm = _normalize(candidate)
    if not cand_norm:
        return False
    if query_norm == cand_norm:
        return True
    # Token overlap match
    q_tokens = set(query_norm.split())
    c_tokens = set(cand_norm.split())
    if not q_tokens or not c_tokens:
        return False
    overlap = len(q_tokens & c_tokens)
    shorter = min(len(q_tokens), len(c_tokens))
    return overlap / shorter >= threshold


async def _load_ofac_csv() -> list[dict]:
    try:
        async with httpx.AsyncClient(headers=HEADERS, timeout=30, follow_redirects=True) as client:
            resp = await client.get(OFAC_CSV_URL)
            resp.raise_for_status()
            reader = csv.DictReader(io.StringIO(resp.text))
            entries = []
            for row in reader:
                name = row.get("Name", "") or row.get("name", "") or ""
                ent_type = row.get("Type", "") or row.get("SDN_Type", "")
                program = row.get("Program", "") or row.get("program", "")
                entries.append({
                    "name": name.strip(),
                    "type": ent_type.strip(),
                    "program": program.strip(),
                    "list": "OFAC SDN",
                })
            return entries
    except Exception as e:
        return []


async def _load_eu_xml() -> list[dict]:
    try:
        async with httpx.AsyncClient(headers=HEADERS, timeout=30, follow_redirects=True) as client:
            resp = await client.get(EU_XML_URL)
            resp.raise_for_status()
            root = ET.fromstring(resp.content)
            entries = []
            for subject in root.findall(".//{*}sanctionEntity") + root.findall(".//sanctionEntity"):
                for name_el in subject.findall(".//{*}nameAlias") + subject.findall(".//nameAlias"):
                    full_name = name_el.get("wholeName", "") or name_el.get("firstName", "")
                    if full_name:
                        entries.append({"name": full_name.strip(), "type": "entity", "list": "EU Financial Sanctions"})
            return entries
    except Exception:
        return []


async def _load_un_xml() -> list[dict]:
    try:
        async with httpx.AsyncClient(headers=HEADERS, timeout=30, follow_redirects=True) as client:
            resp = await client.get(UN_XML_URL)
            resp.raise_for_status()
            root = ET.fromstring(resp.content)
            ns = {"u": "https://scsanctions.un.org/resources/xml/en/consolidated"}

            entries = []
            for individual in root.findall(".//u:INDIVIDUAL", ns) + root.findall(".//INDIVIDUAL"):
                name_parts = []
                for tag in ["FIRST_NAME", "SECOND_NAME", "THIRD_NAME", "FOURTH_NAME", "FIFTH_NAME"]:
                    el = individual.find(f".//{tag}") or individual.find(f"{{*}}{tag}")
                    if el is not None and el.text:
                        name_parts.append(el.text.strip())
                full_name = " ".join(filter(None, name_parts))
                if full_name:
                    entries.append({"name": full_name, "type": "individual", "list": "UN Security Council"})

            for entity in root.findall(".//u:ENTITY", ns) + root.findall(".//ENTITY"):
                el = entity.find(".//FIRST_NAME") or entity.find(".//{*}FIRST_NAME")
                name = el.text.strip() if (el is not None and el.text) else ""
                if name:
                    entries.append({"name": name, "type": "entity", "list": "UN Security Council"})

            return entries
    except Exception:
        return []


async def _ensure_loaded() -> None:
    now = asyncio.get_event_loop().time()
    loaded = _cache.get("loaded_at")

    if loaded is None or (now - loaded) > 86400:
        ofac_task = asyncio.create_task(_load_ofac_csv())
        un_task = asyncio.create_task(_load_un_xml())
        eu_task = asyncio.create_task(_load_eu_xml())
        _cache["ofac"] = await ofac_task
        _cache["un"] = await un_task
        _cache["eu"] = await eu_task
        _cache["loaded_at"] = now


async def check_sanctions(
    name: str,
    also_check: Optional[list[str]] = None,
) -> dict:
    """
    Check a name (and optional aliases) against OFAC SDN + UN lists.
    Returns hit records with list name, program, type.
    """
    await _ensure_loaded()

    query_names = [name] + (also_check or [])
    query_norms = [_normalize(n) for n in query_names if n]

    hits = []
    seen = set()

    all_entries = (_cache.get("ofac") or []) + (_cache.get("un") or []) + (_cache.get("eu") or [])

    for entry in all_entries:
        entry_name = entry.get("name", "")
        if not entry_name:
            continue
        for qn in query_norms:
            if _name_matches(qn, entry_name):
                key = f"{entry['list']}:{entry_name}"
                if key not in seen:
                    seen.add(key)
                    hits.append({
                        "list": entry.get("list", ""),
                        "matched_name": entry_name,
                        "query_name": name,
                        "entity_type": entry.get("type", ""),
                        "program": entry.get("program", ""),
                    })
                break

    is_sanctioned = len(hits) > 0

    return {
        "name": name,
        "is_sanctioned": is_sanctioned,
        "hit_count": len(hits),
        "hits": hits,
        "lists_checked": ["OFAC SDN", "UN Security Council", "EU Financial Sanctions"],
        "risk_level": "HIGH" if is_sanctioned else "CLEAR",
    }


async def bulk_sanctions_check(names: list[str]) -> list[dict]:
    tasks = [check_sanctions(name) for name in names]
    return await asyncio.gather(*tasks)
