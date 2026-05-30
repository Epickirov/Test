"""Stage 2: the authoritative, *live* price source.

THIS is the function that must hit a real data source. The LLM calls it as a
tool; the LLM does not supply the prices itself. Right now it is a STUB that
returns clearly-fake data so the end-to-end loop runs without credentials.

>>> Plug your real, live app in here. <<<
If you already have a working Qwen-based app that returns live Taobao/Alibaba
prices, replace the body of `lookup_prices` with a call into it.

Reminder on the access wall we discussed: real Taobao item/price search runs
through the Taobao Open Platform (open.taobao.com) -- typically the Taoke /
淘宝客 (affiliate) APIs -- which require a registered app and approval. Qwen
does NOT grant that access; this function is where that credentialed call goes.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Listing:
    title: str
    price_cny: float
    seller: str
    url: str


# --- STUB DATA -------------------------------------------------------------
# Obviously-fake so nobody mistakes it for real pricing. Delete when wiring
# in the live source.
_STUB = [
    Listing("<example listing A>", 49.0, "<seller A>", "https://example.com/a"),
    Listing("<example listing B>", 62.5, "<seller B>", "https://example.com/b"),
    Listing("<example listing C>", 88.0, "<seller C>", "https://example.com/c"),
]


def lookup_prices(query: str, limit: int = 5) -> list[dict]:
    """Return live listings for `query`, cheapest first.

    STUB IMPLEMENTATION -- returns fake data. Replace with a real call to your
    live price app / the Taobao Open Platform. Returning real data here is the
    only place "live prices" legitimately enters the system.
    """
    # TODO: replace everything below with your live data source, e.g.:
    #   results = your_live_app.search(query)
    #   return [r.as_dict() for r in results[:limit]]
    listings = sorted(_STUB, key=lambda x: x.price_cny)[:limit]
    return [
        {
            "title": f"{x.title} (query={query!r})",
            "price_cny": x.price_cny,
            "seller": x.seller,
            "url": x.url,
        }
        for x in listings
    ]
