"""Stage 3: orchestration. Qwen decides when to call the price tool and then
summarises/ranks the results for the HUD.

Flow:
    image -> identify_product() -> Qwen (with price_lookup tool) -> HUD text

The model is the glue and the eyes. It does NOT invent prices: the only price
data it sees comes from the price_lookup tool result we hand back to it.
"""

from __future__ import annotations

import json
import os

import dashscope

from price_lookup import lookup_prices
from qwen_vision import identify_product

CHAT_MODEL = os.environ.get("QWEN_CHAT_MODEL", "qwen-plus")

# Tool schema advertised to the model (OpenAI-style function calling).
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "lookup_prices",
            "description": (
                "Get LIVE retail listings and prices for a product. This is "
                "the only authoritative source of price data. Always call this "
                "before quoting any price -- never guess prices yourself."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search-friendly product name.",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max listings to return.",
                        "default": 5,
                    },
                },
                "required": ["query"],
            },
        },
    }
]

_SYSTEM = (
    "You help someone wearing AR glasses compare prices in real time. "
    "You will be told what product they are looking at. Call lookup_prices to "
    "get LIVE prices, then reply with one short line suitable for a heads-up "
    "display: cheapest price, seller, and the range. Never state a price that "
    "did not come from a lookup_prices result."
)


def _call_qwen(messages):
    return dashscope.Generation.call(
        model=CHAT_MODEL,
        messages=messages,
        tools=TOOLS,
        result_format="message",
        api_key=os.environ["DASHSCOPE_API_KEY"],
    )


def compare_prices_for_image(image_path_or_url: str) -> str:
    """Full loop: identify the item, look up live prices, return HUD text."""
    product = identify_product(image_path_or_url)
    if product == "UNKNOWN":
        return "Couldn't identify the item — try getting closer or scanning a barcode."

    messages = [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": f"The user is looking at: {product}"},
    ]

    # First turn: the model should ask to call the tool.
    response = _call_qwen(messages)
    msg = response["output"]["choices"][0]["message"]
    messages.append(msg)

    # Resolve any tool calls, then let the model produce the final HUD line.
    tool_calls = msg.get("tool_calls") or []
    for call in tool_calls:
        if call["function"]["name"] == "lookup_prices":
            args = json.loads(call["function"]["arguments"])
            result = lookup_prices(**args)
            messages.append(
                {
                    "role": "tool",
                    "name": "lookup_prices",
                    "content": json.dumps(result, ensure_ascii=False),
                }
            )

    if tool_calls:
        final = _call_qwen(messages)
        return final["output"]["choices"][0]["message"]["content"]
    return msg.get("content", "")


if __name__ == "__main__":
    import sys

    if len(sys.argv) != 2:
        print("Usage: python agent.py <image_path_or_url>")
        raise SystemExit(1)
    print(compare_prices_for_image(sys.argv[1]))
