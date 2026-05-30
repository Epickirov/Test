# AR Glasses → Qwen → Live Price Comparison (scaffold)

A runnable skeleton for the loop:

```
glasses camera frame
      │
      ▼
qwen_vision.identify_product()     ← Qwen-VL: "what is this product?"
      │
      ▼
agent.compare_prices_for_image()   ← Qwen function-calling orchestration
      │
      ▼
price_lookup.lookup_prices()       ← THE LIVE PRICE SOURCE (currently a stub)
      │
      ▼
HUD text for the glasses
```

## The one rule this scaffold enforces

**The LLM never invents prices.** Qwen identifies the product and decides when
to fetch prices, but every price shown comes from `lookup_prices()` — a real
tool call to an authoritative source. If you let the model recall prices from
its weights, they are stale/hallucinated, not "live."

## Where your live app plugs in

`price_lookup.lookup_prices()` is a **stub** returning obviously-fake data so
the loop runs without credentials. Replace its body with your real live price
source (your existing Qwen-based app, or a direct Taobao Open Platform /
淘宝客 affiliate API call). That credentialed access is the part Qwen does
*not* grant you — it lives in this function.

## Run it

```bash
pip install -r requirements.txt
export DASHSCOPE_API_KEY=sk-...        # Alibaba Cloud Model Studio key
python agent.py path/or/url/to/item.jpg
```

## Files

| File | Stage |
|------|-------|
| `qwen_vision.py` | Image → product name (Qwen-VL) |
| `price_lookup.py` | Product name → live prices (**plug in your app here**) |
| `agent.py` | Orchestration + HUD output (Qwen function-calling) |
