"""Stage 1: turn a camera frame into a product identity using Qwen-VL.

This is the part Qwen genuinely excels at: looking at an arbitrary image
(a frame from the AR glasses' camera) and describing *what the product is*.
It does NOT return prices -- pricing comes from a separate authoritative
lookup (see price_lookup.py). Keeping these separate is deliberate: an LLM
must not be the source of "live" prices.
"""

from __future__ import annotations

import os
from dashscope import MultiModalConversation

# Qwen-VL model. Swap for the latest vision model you have access to.
VISION_MODEL = os.environ.get("QWEN_VL_MODEL", "qwen-vl-max")

_PROMPT = (
    "You are the product-recognition step of a price-comparison tool. "
    "Look at the image and identify the single main retail product. "
    "Respond with a short, search-friendly product name only (brand + model "
    "+ type if visible). Do NOT guess a price. If you cannot tell what it is, "
    "respond with the literal word UNKNOWN."
)


def identify_product(image_path_or_url: str) -> str:
    """Return a short, search-friendly product name for the item in the image.

    `image_path_or_url` may be a local file path (use a file:// URL) or a
    public https URL. Returns "UNKNOWN" if the model can't identify the item.
    """
    messages = [
        {
            "role": "user",
            "content": [
                {"image": image_path_or_url},
                {"text": _PROMPT},
            ],
        }
    ]

    response = MultiModalConversation.call(
        model=VISION_MODEL,
        messages=messages,
        api_key=os.environ["DASHSCOPE_API_KEY"],
    )

    # MultiModalConversation returns content as a list of {"text": ...} parts.
    content = response["output"]["choices"][0]["message"]["content"]
    text = "".join(part.get("text", "") for part in content).strip()
    return text or "UNKNOWN"
