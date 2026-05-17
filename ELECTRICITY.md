# Electricity-usage dashboard — handoff

Reverse-engineered API notes for a future session to build a realtime dashboard of greenhouse electricity-meter data from the **能源管理系统 / 云集抄表** ("YJCB") energy-monitoring platform.

## Goal

A web dashboard showing 10 electricity meters monitoring greenhouse infrastructure (main cabinet, zone power, ventilation fans, mist sprayer, irrigation, motor monitoring). Per meter: 3-phase voltage, 3-phase current, active power (kW), power factor, online/offline state, recent alarms. Historical kWh consumption charts optional for v1.

## Hosts

| Purpose | URL |
|---|---|
| Web UI (v2, jQuery + Vue2 + ElementUI hybrid — what we reverse-engineered) | `https://nh2.yunjichaobiao.com` |
| Web UI (v3, modern Vue SPA — same backend, useful for spotting newer endpoints) | `http://nh3.yunjichaobiao.com/#/electric/home` |
| **REST API base** | `https://nh2api.yunjichaobiao.com` |
| Static / video assets (Aliyun OSS) | `https://nh2-bucket.oss-cn-shenzhen.aliyuncs.com` |

**CORS**: `Access-Control-Allow-Origin: *` on API responses, preflight passes. A pure browser-side dashboard (any origin) can call the API directly — no proxy needed.

## Credentials

- **UserID** (login): `N12870` — project ID `12870`, prefixed with `N`
- **Password**: `yncn2000`
- Internal user ID: `22283` (visible in the JWT's `userId` claim after login)

## Authentication

### 1. Captcha-protected login

The flow:

1. **Generate `keyStr` client-side** — random 12-char string from uppercase letters + digits. This binds the captcha to your session.
2. **Fetch the captcha**:
   ```
   POST https://nh2api.yunjichaobiao.com/api/Account/GetCaptcha?keyStr=<KEY>
   Content-Type: application/x-www-form-urlencoded; charset=UTF-8
   keyStr=<KEY>
   ```
   Response is a 56×27 PNG of a 4-character **case-sensitive** alphanumeric captcha, base64-encoded inside the `Data` field of the double-JSON-encoded wrapper.
3. **Solve it.** OCR-able (Tesseract gets ~70%; retry-on-failure loop or a small CNN classifier reaches ~95%). For a real dashboard: show the image inline once and let the operator type it on first launch.
4. **Login**:
   ```
   POST https://nh2api.yunjichaobiao.com/api/Account/Login
   Content-Type: application/x-www-form-urlencoded; charset=UTF-8
   UserID=N12870&Password=yncn2000&client=0&Code=<captcha>&keyStr=<SAME_KEY>&Language=cn
   ```
   On success the wrapper has `IsSuccess:true` and a `Token` field containing a JWT (24–30 h validity). The captcha is single-use — fetch a fresh one on every login attempt.

Failure: `ErrorCode:"409"`, `ErrorMsg:"验证码错误！"` ("captcha error") — retry with a fresh captcha.

There's a demo bypass in the SPA (`?type=yanshi`) that uses `Code: "yjyj"` — but that's for the platform's demo account, not yours.

### 2. Bearer token on every other call

```
Authorization: Bearer <JWT>
Content-Type: application/json
```

**Almost everything is `POST`** — even semantically-read-only endpoints. Empty body = `{}`.

### 3. Token rotation

Every successful API response includes a **freshly-issued `Token`** in the wrapper. The frontend (`yjCommon.updateUserToken`) overwrites the stored token on each call. For a long-running script:

> Read the response's `Token` field and use **that one** on the next request — the `exp` claim is refreshed on every call. If you keep using the original token and stop calling, it expires at the original `exp` (~24 h after last use).

## Response shape (every endpoint)

Every JSON response is **triple-wrapped**:

1. UTF-8 BOM prefix (`\xef\xbb\xbf`) — strip it.
2. The body is itself a JSON-encoded string — `json.loads` once to get a string.
3. The wrapper `Data` field is often *also* a JSON-encoded string — `json.loads` again to get the actual payload.

Python parser:

```python
import json

def parse(body: bytes):
    s = body.lstrip(b'\xef\xbb\xbf').decode('utf-8')
    wrapper = json.loads(s)
    if isinstance(wrapper, str):           # outer double-encoding
        wrapper = json.loads(wrapper)
    data = wrapper.get('Data')
    if isinstance(data, str):
        try: data = json.loads(data)
        except json.JSONDecodeError: pass  # some endpoints return Data as a plain string
    return wrapper, data
```

JavaScript:

```js
async function call(url, body, token) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  let txt = await r.text();
  if (txt.charCodeAt(0) === 0xFEFF) txt = txt.slice(1);
  let wrapper = JSON.parse(txt);
  if (typeof wrapper === 'string') wrapper = JSON.parse(wrapper);
  let data = wrapper.Data;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch {} }
  return { wrapper, data, newToken: wrapper.Token };  // overwrite your stored token with newToken
}
```

Wrapper shape:

```
{
  "IsSuccess": true|false,
  "Token":     "<fresh JWT>",   // use this for the next call
  "ErrorCode": "" | "409" | ...,
  "ErrorMsg":  null | "..." ,
  "Data":      <payload (often a JSON-encoded string)>
}
```

## API endpoints actually needed for the dashboard

All paths are relative to `https://nh2api.yunjichaobiao.com`. All POST. All authed with `Authorization: Bearer <JWT>`.

### Confirm project type
```
POST /api/Main/GetHomePageType
{}
→ Data: "ammeter"     // confirms this account's dashboard type is electricity-meters
```

### List meters (one-shot inventory)
```
POST /api/SetMeter/GetAmmeterAll
{}
```
Returns an array of meter objects. The fields the dashboard actually uses:

| Field | Meaning |
|---|---|
| `ID`           | numeric meter id — pass this to all other endpoints |
| `Code`         | model (`DTZY71-G` = three-phase, `DSZY71-G` = single-phase) |
| `Name`         | human-readable label (Chinese) |
| `Address`      | hardware/comms address |
| `LineState`    | **1 = online, 0 = offline** |
| `AreaID`       | area/zone id |
| `Sort`         | display order |

Most other fields are nullable / 0 for this account.

#### The 10 meters currently registered

| ID | Name | Address | Online |
|---|---|---|---|
| 166301 | 总柜（表1） — Main cabinet | 219250037301 | ✅ |
| 166325 | 4区动力（表1） — Zone 4 power | 219250037305 | ✅ |
| 166319 | 湿帘风机（表2） — Wet-curtain fan | 219250037304 | ✅ |
| 166328 | 4-1区控制柜（表2） — Zone 4-1 control cabinet | 219250036144 | ✅ |
| 166320 | 上部风机（表3） — Upper fan | 219250037303 | ✅ |
| 166334 | 4-2区控制柜（表3） — Zone 4-2 control cabinet | 219250036145 | ✅ |
| 166311 | 高压喷雾（表4） — High-pressure mist | 219250037302 | ❌ offline |
| 106625 | 55kw电机监控电表 — 55 kW motor monitor | 219240017072 | ✅ |
| 168131 | 成苗浇水 — Mature-seedling irrigation | 219250036841 | ✅ |
| 168145 | 幼苗浇水 — Seedling irrigation | 219250036842 | ✅ |

The dashboard should iterate and let the list grow / shrink dynamically.

### Realtime per-meter snapshot (the main dashboard call)
```
POST /api/Device/AmmeterData_Summary
{ "ammeterID": 166301 }
```
Verified live response shape (meter 166301 = 总柜):
```json
[
  { "Keyword": "Power", "Explain": "功率",     "ValueAP": "4.208",  "AlertList": [] },
  { "Keyword": "V",     "Explain": "电压",     "ValueA": "231",   "ValueB": "231.5", "ValueC": "229.9", "AlertList": [] },
  { "Keyword": "A",     "Explain": "电流",     "ValueA": "9.8",   "ValueB": "9.16",  "ValueC": "8.6",   "AlertList": [] },
  { "Keyword": "PF",    "Explain": "功率因数",  "ValueA": null,    "ValueB": null,    "ValueC": null,    "AlertList": [] }
]
```

Field semantics:

| Key in block | Meaning |
|---|---|
| `ValueA` / `ValueB` / `ValueC` | per-phase values (R / S / T phases for 3-phase meter) |
| `ValueAP`      | active power (kW)     — populated on the `Power` block |
| `ValueRP`      | reactive power (kVar) — populated on the `Power` block when present |
| `ValueTotal`   | total across phases   — populated when applicable |
| `Ratio_AP_Rated` | active-power / rated capacity ratio |
| `AlertList`    | array of active alarms for this metric on this meter |

Block keywords always present: `Power`, `V`, `A`, `PF`. Values come back as **strings** (e.g. `"231"`, `"9.8"`) — parse to Number for arithmetic.

**Polling**: there's no WebSocket/MQTT push. The frontend polls this endpoint every 30–60 s per meter. Realistic dashboard: loop over `LineState===1` meters every 30 s, fire one `AmmeterData_Summary` call per meter (or in parallel), update each card.

### Top-consumption ranking (optional, for a "biggest users today" widget)
```
POST /api/Main/GetEnergyTop
{ "dateType": "D" }       // D = day, M = month, Y = year
```
Returns an array of `{ID, Name, Energy, ...}` (verified call returned `[]` overnight when there's no data yet for "today"; works during the day).

### Recent alarms
```
POST /api/Main/GetRecentWarnTop
{}
```

### Total energy used (the big homepage number)
```
POST /api/Main/GetUseEnergy
{}
```
Note: this one is a `GET` endpoint, not POST, on the actual server. If POST returns `{"Message":"请求的资源不支持 http 方法 POST"}` use GET instead. A few `/api/Main/*` and `/api/Account/*` endpoints are like this.

### Historical time-series (line charts) — needs DevTools verification

The bundle has 4 endpoints per electrical metric: `Summary<X>` / `PageFor<X>` / `Chart<X>` / `Export<X>`. The acronyms follow Chinese pinyin abbreviations:

| Abbr | Meaning | Unit |
|---|---|---|
| `YGDL` | 有功电量 — active energy | kWh |
| `WGDL` | 无功电量 — reactive energy | kVarh |
| `YGGL` | 有功功率 — active power | kW |
| `WGGL` | 无功功率 — reactive power | kVar |
| `DY`   | 电压 — voltage | V |
| `DL`   | 电流 — current | A |
| `SZGL` | 视在功率 — apparent power | kVA |
| `GLYS` | 功率因数 — power factor | unitless |
| `DJDL` | 单价电量 — billed/tariff energy | kWh |
| `DFL`  | 电费率 — tariff (peak / flat / off-peak) | — |
| `ZDXL` | 最大需量 — max demand | kW |

So the active-energy line chart is `POST /api/Monitor/ChartYGDL`, paginated table is `POST /api/Monitor/PageForYGDL`, summary stat is `POST /api/Monitor/SummaryYGDL`, CSV export is `POST /api/Monitor/ExportYGDL`. Same pattern for every metric.

**Param shape**: my probes with `{ammeterIDS:"166301", startDate, endDate, dateType:"D"}` and `{ammeterIDList:[166301], ...}` both returned HTTP 500. When the dashboard adds historical charts, the cleanest move is:

1. Open `https://nh2.yunjichaobiao.com` in a browser, log in, navigate to a chart page (e.g. Monitor → 有功电量).
2. Open DevTools → Network tab.
3. Trigger the chart and copy the exact request body Chrome shows — that's the canonical param shape for that endpoint.

Alternatively, fetch the per-page JS chunk that owns that chart and read its caller. Skip this for v1 — realtime cards from `AmmeterData_Summary` are enough for a first version.

## Suggested dashboard architecture

Since CORS is open and the data is sensitive only to the operator, a pure static HTML page works. No backend needed.

```
┌──────────────────────────────────────────────┐
│  Static HTML on any host (or even file://)   │
│                                              │
│  on load:                                    │
│    1. Read token + uid from localStorage     │
│    2. If missing or 401: show captcha img,   │
│       prompt for code, POST /api/Account/    │
│       Login, store token.                    │
│    3. POST /api/SetMeter/GetAmmeterAll       │
│       → render one card per LineState===1    │
│    4. Every 30 s, for each meter ID,         │
│       POST /api/Device/AmmeterData_Summary   │
│       → update card V/A/Power/PF values.     │
│    5. After every response, store the new    │
│       Token from wrapper.Token.              │
│    6. On 401: clear stored token, jump to 2. │
└──────────────────────────────────────────────┘
```

For a more reliable / always-on view: a Cloudflare Worker on a cron trigger does steps 2–5 every minute, writes the latest snapshot to KV (or a row to D1 for history), and the static page reads from KV via a public Worker endpoint. The captcha is solved once by the operator, the cookie/token persists in Worker secrets/KV, and the Worker refreshes via re-login (with OCR or human-prompted captcha) when the token expires.

## Gotchas at a glance

- ⚠️ **Captcha-bound login**: 4-char alphanumeric, **case-sensitive**, single-use. Fetch a fresh one on every attempt.
- ⚠️ **Double-JSON-encoded responses with UTF-8 BOM** — use the parser cookbook above.
- ⚠️ **Token rotates per response** — must store and reuse the new one from each wrapper.
- ⚠️ **Almost all endpoints are POST**, even reads. A few `/api/Main/*` are GET.
- ⚠️ **Numeric values come back as strings** — `parseFloat()` before doing arithmetic.
- ⚠️ **No push channel** — REST polling only; 30–60 s is the right cadence.

## Reverse-engineering reference files

Pulled fresh from `https://nh2.yunjichaobiao.com` if anything looks off:

| Path | What's in it |
|---|---|
| `config.js`             | API base URL + helper hosts (`hostConfig`) |
| `js/common.js`          | The full **`yjAPI` endpoint map** (712 names → URLs), the `yjAjax` wrapper that sets `Authorization: Bearer` headers |
| `js/login.js`           | `loginGoHome()`, captcha `draw()`, the `randomWord(12)` keyStr generator |
| `js/toolkit.js`         | Misc utility helpers used across pages |
| `version.js`            | Current frontend version + cache-busting logic |
| `login.html`            | Login form (`#username`, `#password`, `#code`, `#canvas`) |

712 endpoints in total across these namespaces (in case you need something beyond the 4 listed above):

| Namespace | # endpoints | What it's for |
|---|---|---|
| `Monitor`         | 154 | Time-series / charts / tables for every electrical metric |
| `System`          | 101 | User mgmt, project settings, privileges |
| `SetMeter`        |  92 | Add/edit/list meters, pay plans, thresholds |
| `Effect`          |  61 | Effect analysis / reports |
| `Device`          |  59 | Per-device readings + alarms (AmmeterData_Summary lives here) |
| `app`             |  30 | SIM-card management for the GSM meters |
| `Performance`     |  22 | Energy-performance plans, KPI tracking |
| `GatherPlan`      |  21 | Data-gathering schedules |
| `OnlineExam`      |  20 | (Training module) |
| `SetFocus`        |  19 | Focus/concentrator unit config |
| `Login` / `Account` | 15 + 5 | Login flows (SMS, WeChat, etc.) |
| `Govern`          |  15 | Governance |
| `Customize`       |  15 | Custom-defined reports |
| `ElecCharge`      |  15 | Tariff / billing |
| `DataReporting`   |  15 | Reporting |
| `Main`            |  14 | Top-level dashboard widgets |
| `Notice`          |  14 | Notifications |
| (smaller) | <10 each | AutomaticAccount, Customer, EnergyGather, Enter, Download |

For v1 you only need `Account/Login`, `Account/GetCaptcha`, `SetMeter/GetAmmeterAll`, `Device/AmmeterData_Summary`, and maybe `Main/GetEnergyTop` / `Main/GetRecentWarnTop`.
