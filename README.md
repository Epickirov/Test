# AR Glasses → Qwen → Live Price Comparison (scaffold)

Text-search price comparison, matching the proven pattern from the other app:
**concatenate the `checks` and `specifications` fields and use that as the
Alibaba search query** (not image search).

```
checks field + specifications field
        │  concatenate (deterministic, in code — query.build_query)
        ▼
   search query  ──►  price_lookup.lookup_prices()   ← LIVE Alibaba search
        │
        ▼
   Qwen  ──►  rank / summarise listings into one HUD line
```

## Two rules this scaffold enforces

1. **The LLM never builds the query.** Concatenating the two fields is plain
   code (`query.py`). Deterministic, matching the other app.
2. **The LLM never invents prices.** Every price comes from
   `lookup_prices()`; Qwen only summarises the listings it's handed.

## Where your live app plugs in

`price_lookup.lookup_prices(query)` is a **stub** returning obviously-fake data
so the loop runs without credentials. Replace its body with your existing live
Alibaba search. It already takes the concatenated text query — wire it straight
in.

## Files

| File | Role |
|------|------|
| `query.py` | `checks` + `specifications` → search query (deterministic) |
| `price_lookup.py` | query → live Alibaba listings (**plug your app in here**) |
| `agent.py` | orchestration + Qwen-ranked HUD output |
| `qwen_vision.py` | *optional* — derive the field text from a glasses frame |

## Run it

```bash
pip install -r requirements.txt
export DASHSCOPE_API_KEY=sk-...        # Alibaba Cloud Model Studio key
python agent.py "<checks text>" "<specifications text>"
```

For the optional glasses path, call `qwen_vision.fields_from_frame(image)` to
suggest the two fields, then pass them into `agent.compare_prices(...)`.
