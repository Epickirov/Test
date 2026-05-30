"""OPTIONAL helper: derive the checks / specifications text from a glasses frame.

The price search itself is TEXT-based (see query.py / price_lookup.py), not
image search. But on AR glasses the user may not type the fields, so this
optionally uses Qwen-VL to look at a camera frame and *suggest* text to drop
into the `checks` and `specifications` fields. The Alibaba search still
receives plain text -- the image never leaves this step.

Skip this module entirely if the fields are typed or dictated.
"""

from __future__ import annotations

import json
import os

from dashscope import MultiModalConversation

VISION_MODEL = os.environ.get("QWEN_VL_MODEL", "qwen-vl-max")

_PROMPT = (
    "Look at the product in the image. Return STRICT JSON with two keys: "
    '"checks" (the product name: brand + model + type) and "specifications" '
    "(any visible specs: size, capacity, colour, material). Values are plain "
    "text. Do not include prices. If unsure, use empty strings."
)


def fields_from_frame(image_path_or_url: str) -> tuple[str, str]:
    """Return (checks, specifications) text suggested from the image."""
    messages = [
        {
            "role": "user",
            "content": [{"image": image_path_or_url}, {"text": _PROMPT}],
        }
    ]
    response = MultiModalConversation.call(
        model=VISION_MODEL,
        messages=messages,
        api_key=os.environ["DASHSCOPE_API_KEY"],
    )
    content = response["output"]["choices"][0]["message"]["content"]
    text = "".join(part.get("text", "") for part in content).strip()
    try:
        data = json.loads(text)
        return str(data.get("checks", "")), str(data.get("specifications", ""))
    except (json.JSONDecodeError, AttributeError):
        return "", ""
