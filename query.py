"""Build the Alibaba search query from the two input fields.

Mirrors the proven pattern from the user's other app: concatenate the
`checks` text field and the `specifications` field and use the result as a
plain-text search query (NOT image search). Deterministic on purpose -- the
LLM is not involved in forming the query.
"""

from __future__ import annotations


def build_query(checks: str, specifications: str) -> str:
    """Concatenate the checks and specifications fields into a search query."""
    return " ".join(part.strip() for part in (checks, specifications) if part and part.strip())
