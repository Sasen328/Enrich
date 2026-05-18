"""
AI-Powered Extraction — ScrapeGraphAI-style
Uses Gemini Flash to extract structured data from scraped HTML/text.
Handles Arabic + English Saudi company pages.
"""

import os
import json
import re
from typing import Any, Optional

from google import genai
from google.genai import types
from tenacity import retry, stop_after_attempt, wait_exponential

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
_client: Optional[genai.Client] = None

def _get_client() -> genai.Client:
    global _client
    if _client is None:
        if not GEMINI_API_KEY:
            raise RuntimeError("GEMINI_API_KEY not set")
        _client = genai.Client(api_key=GEMINI_API_KEY)
    return _client

COMPANY_SCHEMA = {
    "name_en": "Company name in English or null",
    "name_ar": "Company name in Arabic or null",
    "description": "1-2 sentence company description or null",
    "industry": "Business sector/industry or null",
    "founded": "Founding year YYYY or null",
    "headquarters": "City in Saudi Arabia or null",
    "employees": "Employee count or range or null",
    "website": "Website URL or null",
    "phone": "Primary phone number or null",
    "email": "Primary email or null",
    "cr_number": "Commercial Registration number (10 digits starting with 1) or null",
    "vat_number": "VAT number (15 digits starting with 3) or null",
    "services": ["List of main services/products"],
    "clients": ["Notable clients if mentioned"],
    "certifications": ["ISO, SASO, or other certifications"],
    "social_media": {
        "twitter": "URL or null",
        "linkedin": "URL or null",
        "instagram": "URL or null",
    },
    "is_saudi_company": "true/false",
    "is_vision2030_aligned": "true/false based on sectors mentioned",
}


def _clean_json_response(text: str) -> str:
    text = re.sub(r"^```json\s*", "", text.strip())
    text = re.sub(r"^```\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


@retry(
    stop=stop_after_attempt(2),
    wait=wait_exponential(multiplier=1, min=2, max=8),
)
async def ai_extract_company(
    page_text: str,
    page_url: str,
    schema: Optional[dict] = None,
) -> dict:
    if not GEMINI_API_KEY:
        return {"error": "GEMINI_API_KEY not set", "url": page_url}

    if schema is None:
        schema = COMPANY_SCHEMA

    truncated = page_text[:6000] if len(page_text) > 6000 else page_text

    prompt = f"""Extract structured company data from this Saudi company web page.

URL: {page_url}

Page content:
{truncated}

Return ONLY a JSON object with these fields:
{json.dumps(schema, ensure_ascii=False, indent=2)}

Rules:
- Use null for any field not found in the content
- CR number is 10 digits starting with 1 (e.g. 1010123456)
- VAT number is 15 digits starting with 3
- Only use information actually present in the text
- For Arabic company names, preserve Arabic script"""

    try:
        client = _get_client()
        response = await client.aio.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.1,
                response_mime_type="application/json",
            ),
        )
        raw = response.text or "{}"
        cleaned = _clean_json_response(raw)
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return {"error": "Invalid JSON from Gemini", "url": page_url}
    except Exception as e:
        return {"error": str(e), "url": page_url}


@retry(
    stop=stop_after_attempt(2),
    wait=wait_exponential(multiplier=1, min=2, max=8),
)
async def ai_extract_custom(
    page_text: str,
    page_url: str,
    extraction_goal: str,
    output_schema: dict,
) -> dict:
    if not GEMINI_API_KEY:
        return {"error": "GEMINI_API_KEY not set"}

    truncated = page_text[:6000] if len(page_text) > 6000 else page_text

    prompt = f"""Task: {extraction_goal}

URL: {page_url}

Page content:
{truncated}

Extract and return ONLY a JSON object matching this schema:
{json.dumps(output_schema, ensure_ascii=False, indent=2)}

Return null for any field not found. Return ONLY the JSON object."""

    try:
        client = _get_client()
        response = await client.aio.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0,
                response_mime_type="application/json",
            ),
        )
        raw = response.text or "{}"
        cleaned = _clean_json_response(raw)
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return {"error": "Invalid JSON from Gemini"}
    except Exception as e:
        return {"error": str(e)}
