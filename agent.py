"""Orchestration: text fields -> Alibaba search -> Qwen-ranked HUD output.

Pattern (matches the user's other app):
    checks + specifications  --concatenate-->  search query
    query  -->  price_lookup (live Alibaba search)
    listings  -->  Qwen ranks/summarises  -->  HUD line

The query is built deterministically in code (query.build_query); Qwen only
summarises the live listings it is handed. Qwen never forms the query and
never invents prices.
"""

from __future__ import annotations

import json
import os

import dashscope

from price_lookup import lookup_prices
from query import build_query

CHAT_MODEL = os.environ.get("QWEN_CHAT_MODEL", "qwen-plus")

_SYSTEM = (
    "You help someone wearing AR glasses compare prices in real time. You are "
    "given a JSON list of LIVE Alibaba listings. Reply with one short line for "
    "a heads-up display: cheapest price + seller, then the price range. Only "
    "use prices present in the listings; never invent or adjust a price."
)


def summarise_listings(listings: list[dict]) -> str:
    """Ask Qwen to turn live listings into a single HUD-friendly line."""
    if not listings:
        return "No listings found for that query."

    messages = [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": json.dumps(listings, ensure_ascii=False)},
    ]
    response = dashscope.Generation.call(
        model=CHAT_MODEL,
        messages=messages,
        result_format="message",
        api_key=os.environ["DASHSCOPE_API_KEY"],
    )
    return response["output"]["choices"][0]["message"]["content"]


def compare_prices(checks: str, specifications: str) -> str:
    """Full loop: concatenate fields -> live search -> HUD line."""
    query = build_query(checks, specifications)
    if not query:
        return "Empty query — fill in the checks or specifications field."
    listings = lookup_prices(query)
    return summarise_listings(listings)


if __name__ == "__main__":
    import sys

    if len(sys.argv) != 3:
        print('Usage: python agent.py "<checks>" "<specifications>"')
        raise SystemExit(1)
    print(compare_prices(sys.argv[1], sys.argv[2]))
