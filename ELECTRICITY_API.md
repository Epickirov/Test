# Electricity API — integration reference

Knowledge file for integrating the **N12870 / 云集抄表 / 能源管理系统** electricity-metering API into an app. This is the production-ready reference — every endpoint and payload below was verified live against the user's account.

If you're trying to *build a dashboard from scratch* without prior context, also skim `ELECTRICITY.md` (reverse-engineering handoff) for the bigger picture. This file is the API contract.

---

## TL;DR

- **Base URL**: `https://nh2api.yunjichaobiao.com`
- **CORS**: open (`Access-Control-Allow-Origin: *`) — call directly from the browser, no proxy needed
- **Auth**: `Authorization: Bearer <JWT>` on every request. JWT issued by `POST /api/Account/Login` after solving a 4-character image captcha. Token lifetime ~24 h, rotates with every API response.
- **Verb**: nearly everything is `POST` with a JSON body (even semantically read-only endpoints). A handful (`/api/Account/GetMachineCode`, `/api/System/GetPrivilegeAll`) are GET.
- **Response quirk**: every JSON response is wrapped in a **JSON-encoded string** (parse twice), has a **UTF-8 BOM** prefix, and the `Data` field is often *also* a JSON-encoded string. Numbers come back as strings — `parseFloat` before doing math.
- **Account scope**: project N12870, **11 electricity meters**. Meter `2-2总柜电表` (ID `223904`) — added mid-day 2026-05-18 — is the focus of the current integration.

---

## Credentials

```
UserID:   N12870
Password: yncn2000
```

The JWT decodes to `{userId: "22283", PID: "12870", Lang: "cn", exp: ...}`.

---

## Quick start — get current usage in 30 lines (Python)

```python
import json, base64, time, random, string, urllib.request, urllib.parse

API = "https://nh2api.yunjichaobiao.com"

def parse(body: bytes):
    s = body.lstrip(b"\xef\xbb\xbf").decode("utf-8")
    w = json.loads(s)
    if isinstance(w, str): w = json.loads(w)
    d = w.get("Data")
    if isinstance(d, str):
        try: d = json.loads(d)
        except json.JSONDecodeError: pass
    return w, d

def call(path, body, token):
    req = urllib.request.Request(
        API + path,
        data=json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return parse(r.read())

# --- LOGIN (requires solving a captcha — see "Auth" section below) ---
# captcha_text, key_str = solve_captcha()
# token = login(captcha_text, key_str)

# --- DAILY USAGE (kWh) for meter 2-2 today ---
TOKEN  = "<paste a valid JWT here>"
METER  = 223904
TODAY  = time.strftime("%Y-%m-%d")
w, d = call("/api/Monitor/SummaryYGDL", {
    "dateType": "D", "areaID": 0, "ammeterID": METER,
    "startTime": TODAY, "endTime": TODAY, "valueType": "SJZ",
}, TOKEN)
forward_kwh = next(r["Total"] for r in d if r["keyword"] == "ZX")
print(f"Today's consumption for meter {METER}: {forward_kwh} kWh")

# --- REALTIME power/voltage/current snapshot ---
w, d = call("/api/Device/AmmeterData_Summary", {"ammeterID": METER}, TOKEN)
power = next(r for r in d if r["Keyword"] == "Power")["ValueAP"]
print(f"Realtime active power: {power} kW")
```

---

## Auth — full flow

### Step 1 — Generate a session key client-side

12 chars from `[A-Z0-9]`. Used to bind the captcha to your login attempt.

```python
key_str = "".join(random.choices(string.ascii_uppercase + string.digits, k=12))
```

### Step 2 — Fetch the captcha image

```
POST https://nh2api.yunjichaobiao.com/api/Account/GetCaptcha?keyStr=<KEY>
Content-Type: application/x-www-form-urlencoded; charset=UTF-8
Body: keyStr=<KEY>
```

Response (after BOM-strip and double `json.loads`):
```json
{
  "IsSuccess": true,
  "Data": "\"iVBORw0KGgo... (base64 PNG, wrapped in literal quotes)\""
}
```

Decode: `base64.b64decode(json_decoded_Data.strip('"'))` → a 56×27 PNG of a 4-char case-sensitive alphanumeric string.

### Step 3 — Solve

- For a human-in-the-loop UI: display the image and ask the operator to type it.
- For automation: OCR. Tesseract baseline ~70 %, a 4-char alphanumeric CNN trained on a few hundred examples gets ~95 %. Always retry on `ErrorCode: "409"` ("验证码错误！") with a fresh captcha.

### Step 4 — Login

```
POST https://nh2api.yunjichaobiao.com/api/Account/Login
Content-Type: application/x-www-form-urlencoded; charset=UTF-8

UserID=N12870&Password=yncn2000&client=0&Code=<captcha>&keyStr=<SAME_KEY>&Language=cn
```

Successful response:
```json
{
  "IsSuccess": true,
  "Token": "eyJ0eXAi...",     // JWT — store and use on all subsequent calls
  "Data": "{\"ID\":22283,\"UserID\":\"N12870\", ...}"
}
```

Failure: `IsSuccess:false`, `ErrorCode:"409"`, `ErrorMsg:"验证码错误！"` — captcha was wrong or already consumed.

### Token rotation — important

**Every response includes a fresh `Token` field.** Use it for the next call. The token's `exp` is refreshed on each use. If you keep using the original and stop calling, it dies at the original `exp` (~24 h). If you keep using the *latest* one, the session effectively lives forever (until idle ~24 h).

Recommended pattern:

```python
class Session:
    def __init__(self, initial_token):
        self.token = initial_token
    def call(self, path, body):
        w, d = call(path, body, self.token)
        if w.get("Token"):
            self.token = w["Token"]
        if not w.get("IsSuccess") and w.get("ErrorCode") == "401":
            raise SessionExpired()
        return w, d
```

When you catch `SessionExpired`, redo the captcha+login flow.

---

## Response shape (every endpoint)

Three layers of wrapping. Parser cookbook:

```python
def parse(body: bytes):
    s = body.lstrip(b"\xef\xbb\xbf").decode("utf-8")    # 1. strip UTF-8 BOM
    wrapper = json.loads(s)                              # 2. outer parse
    if isinstance(wrapper, str):
        wrapper = json.loads(wrapper)                    # 3. (often) double-encoded
    data = wrapper.get("Data")
    if isinstance(data, str):
        try: data = json.loads(data)                     # 4. Data is often also JSON-encoded
        except json.JSONDecodeError: pass
    return wrapper, data
```

JavaScript:

```js
async function call(path, body, token) {
  const r = await fetch("https://nh2api.yunjichaobiao.com" + path, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  let txt = await r.text();
  if (txt.charCodeAt(0) === 0xFEFF) txt = txt.slice(1);
  let wrapper = JSON.parse(txt);
  if (typeof wrapper === "string") wrapper = JSON.parse(wrapper);
  let data = wrapper.Data;
  if (typeof data === "string") { try { data = JSON.parse(data); } catch {} }
  return { wrapper, data, newToken: wrapper.Token };
}
```

Wrapper fields:
| Field | Meaning |
|---|---|
| `IsSuccess`     | `true`/`false` |
| `Token`         | rotated JWT — **overwrite stored token with this** |
| `ErrorCode`     | `""` on success, `"401"` token expired, `"409"` captcha error, etc. |
| `ErrorMsg`      | Chinese error message |
| `Data`          | payload (sometimes a JSON-encoded string, sometimes a dict/array) |

---

## Endpoint reference

All POST. All to `https://nh2api.yunjichaobiao.com`. All require `Authorization: Bearer <JWT>` and `Content-Type: application/json` unless noted.

### `/api/Account/Login` — see auth flow above
### `/api/Account/GetCaptcha?keyStr=<KEY>` — see auth flow above

---

### `/api/SetMeter/GetAmmeterAll` — list all meters

Request body: `{}`

Response `Data` (after parse): array of meter objects.

Important fields:
| Field | Meaning |
|---|---|
| `ID`         | numeric meter id (use everywhere) |
| `Code`       | model — `DTZY71-G` = three-phase, `DSZY71-G` = single-phase |
| `Name`       | human-readable Chinese label |
| `Address`    | hardware/comms address |
| `LineState`  | `1` online, `0` offline |
| `AreaID`     | area/zone id |
| `Sort`       | display order |

---

### `/api/Device/AmmeterData_Summary` — realtime snapshot (THE main dashboard call)

Request body:
```json
{ "ammeterID": 223904 }
```

Response `Data`: array of 4 blocks (Power / V / A / PF). Each block has per-phase + total fields, most nullable.

```json
[
  { "Keyword": "Power", "Explain": "功率",
    "ValueAP": "5.874",       // active power, kW
    "ValueRP": null,          // reactive power, kVar
    "ValueTotal": null,
    "AlertList": [] },
  { "Keyword": "V", "Explain": "电压",
    "ValueA": "238.6", "ValueB": "241.1", "ValueC": "241.2",   // per-phase V
    "AlertList": [] },
  { "Keyword": "A", "Explain": "电流",
    "ValueA": "10.68", "ValueB": "11.64", "ValueC": "11.46",   // per-phase A
    "AlertList": [] },
  { "Keyword": "PF", "Explain": "功率因数",
    "ValueA": null, "ValueB": null, "ValueC": null,            // power factor — often null
    "AlertList": [] }
]
```

**Notes:**
- Values come back as **strings** — `parseFloat` before doing arithmetic.
- `AlertList` is populated when a configured threshold is breached for that metric on that meter.
- For a brand-new meter, the endpoint may return only `ValueA` populated for the first few hours and `B`/`C` null. The 15-min chart endpoint (`ChartYGGL` etc.) still returns proper 3-phase data. Don't conclude single-phase from one snapshot — re-poll.
- Polling cadence: every 30–60 s is what the official UI does. The user's meters are set to upload every 1 min on the device side, so faster polling won't gain anything.

---

### `/api/Monitor/SummaryYGDL` — kWh totals for a meter (active energy)

`YGDL` = 有功电量 = forward active energy.

Request body:
```json
{
  "dateType":  "D" | "M" | "Y",
  "areaID":    0,                 // 0 = filter by ammeterID only
  "ammeterID": 223904,
  "startTime": "2026-05-20",      // YYYY-MM-DD for D, YYYY-MM for M, YYYY for Y
  "endTime":   "2026-05-20",      // ⚠ MUST NOT be empty — server 500s otherwise
  "valueType": "SJZ"              // "SJZ"=示数值 (meter display), "SJZ_BL"=actual = display * multiplier
}
```

Response `Data`:
```json
[
  { "keyword": "ZX", "Total": 47.4, "Explain": "正向有功总电量(kWh)" },
  { "keyword": "FX", "Total":  0.0, "Explain": "反向有功总电量(kWh)" }
]
```

| keyword | meaning |
|---|---|
| `ZX` (正向) | energy drawn from grid (consumption) |
| `FX` (反向) | energy exported back to grid (typically 0 for greenhouse loads) |

---

### `/api/Monitor/PageForYGDL` — daily/monthly breakdown table

Use this to plot a "daily kWh for the month" bar chart.

Request body:
```json
{
  "listType":  "device",          // "device" = group by meter
  "pageIndex": 1,
  "pageSize":  40,
  "dateType":  "D",               // "D" buckets = day-by-day; "M" = month-by-month
  "areaID":    0,
  "ammeterID": 223904,
  "startTime": "2026-05-01",      // month start for daily breakdown
  "endTime":   "2026-05-20",
  "valueType": "SJZ"
}
```

Response `Data`:
```json
{
  "list": [
    { "ReadingDate": "2026-05-19", "ZValueSum": 285.6, "FValueSum": 0.0,
      "AmmeterID": 223904, "AmmeterName": "2-2总柜电表" },
    { "ReadingDate": "2026-05-20", "ZValueSum":  47.4, "FValueSum": 0.0, ...},
    ...
  ],
  "index":     1,
  "count":     2,
  "pageCount": 1
}
```

---

### `/api/Monitor/ChartYGGL` — intraday active-power curve (the "load curve")

`YGGL` = 有功功率 = active power.

Request body for **15-min** buckets for today:
```json
{
  "dateType":  "mi15",                       // "mi1"=1min, "mi5"=5min, "mi15"=15min, "D"=day
  "areaID":    0,
  "ammeterID": 223904,
  "startTime": "2026-05-20 00:00:00",        // ⚠ datetime with time component for mi*
  "endTime":   "2026-05-20 23:59:59",
  "valueType": "SJZ"
}
```

Response `Data`:
```json
[
  {
    "x_Axis":      "[\"2026-05-20 00:15\", \"2026-05-20 00:30\", ...]",   // ⚠ string, not array — JSON.parse it
    "y_DataTotal": "[1.956, 7.26, 1.95, ...]",                            // total active power, kW
    "y_Data1":     "[0.51, 2.082, 0.50, ...]",                            // phase A
    "y_Data2":     "[0.546, 2.388, 0.54, ...]",                           // phase B
    "y_Data3":     "[0.90, 2.79, 0.91, ...]",                             // phase C
    "y_Data4":     null,
    "y_Data5":     null,
    "y_Data6":     null,
    "Explain":     "有功功率-实际值",
    "StartTime":   "2026-05-20 00:00:00",
    "EndTime":     "2026-05-20 23:59:59"
  }
]
```

**Notes:**
- `x_Axis`, `y_*` are **JSON-encoded strings** even after the outer parse — `JSON.parse` them again.
- Numbers may contain `'-'` (single-quoted string) where data is missing for that bucket. Filter or treat as `null`.
- Length of `y_*` arrays = number of buckets with data so far. The day's grid has 96 × 15-min slots; you'll see fewer until the day is full.

Same shape for `ChartDY` (voltage), `ChartDL` (current), `ChartYGDL` (energy), `ChartWGGL` (reactive power), `ChartGLYS` (power factor), `ChartSZGL` (apparent power), `ChartZDXL` (max demand).

---

### Other useful endpoints (for v2)

| Path | What it does | Notes |
|---|---|---|
| `/api/Main/GetHomePageType`              | Returns `"ammeter"` for this account | Confirm it's an electricity project |
| `/api/Main/GetEnergyTop`                 | Top-consumption meters | Body `{"dateType":"D"}` |
| `/api/Main/GetUseEnergy`                 | Total energy used (homepage big number) | **GET, not POST** |
| `/api/Main/GetRecentWarnTop`             | Recent alarms | Body `{}` |
| `/api/SetMeter/GetAmmeterInfo`           | Detail for one meter | Body `{"ID": 223904}` — may return null for newly-added meters |
| `/api/Monitor/ElectricityUsageRanking`   | Per-meter usage ranking | |
| `/api/ElecCharge/PageForDFZL`            | Cost breakdown (电费总览) | Tariff schedule must be set up first |

Full endpoint surface: 712 endpoints across 23 namespaces (`Monitor` 154, `System` 101, `SetMeter` 92, `Device` 59, `Performance` 22, `ElecCharge` 15, `Main` 14, ...). The bundle's `js/common.js` has the full `yjAPI` map — grep there if you need a name.

Chinese-pinyin acronym decoder:

| Abbr | Chinese | English | Unit |
|---|---|---|---|
| `YGDL` | 有功电量 | active energy | kWh |
| `WGDL` | 无功电量 | reactive energy | kVarh |
| `YGGL` | 有功功率 | active power | kW |
| `WGGL` | 无功功率 | reactive power | kVar |
| `SZGL` | 视在功率 | apparent power | kVA |
| `GLYS` | 功率因数 | power factor | unitless |
| `DY`   | 电压 | voltage | V |
| `DL`   | 电流 | current | A |
| `ZDXL` | 最大需量 | max demand | kW |
| `DJDL` | 单价电量 | billed energy | kWh |
| `DFL`  | 电费率 | tariff (peak/flat/off-peak) | — |

Each metric has 4 endpoints in `/api/Monitor/`: `Summary<X>`, `PageFor<X>`, `Chart<X>`, `Export<X>`.

---

## Meter inventory — N12870 (as of 2026-05-20)

11 meters:

| ID | Name | Address | Type | AreaID | Notes |
|---|---|---|---|---|---|
| `166301` | 总柜（表1） — Main cabinet | 219250037301 | DTZY71-G (3-phase) | 85846 | |
| `166325` | 4区动力（表1） | 219250037305 | DTZY71-G | 85845 | |
| `166319` | 湿帘风机（表2） — Wet-curtain fan | 219250037304 | DTZY71-G | 85846 | |
| `166328` | 4-1区控制柜（表2） | 219250036144 | DTZY71-G | 85845 | |
| `166320` | 上部风机（表3） — Upper fan | 219250037303 | DTZY71-G | 85846 | |
| `166334` | 4-2区控制柜（表3） | 219250036145 | DTZY71-G | 85847 | |
| `166311` | 高压喷雾（表4） — Mist | 219250037302 | DTZY71-G | 85846 | sometimes offline |
| `106625` | 55kw电机监控电表 — 55 kW motor | 219240017072 | DSZY71-G (single-phase) | 56022 | |
| `168131` | 成苗浇水 — Mature-seedling irrigation | 219250036841 | DTZY71-G | 87040 | |
| `168145` | 幼苗浇水 — Seedling irrigation | 219250036842 | DTZY71-G | 87040 | |
| **`223904`** | **`2-2总柜电表` — GH 2-2 Main Cabinet** | 219250066785 | DTZY71-G | 102493 | **NEW** — installed mid-day 2026-05-18 |

To always have an up-to-date list: hit `GetAmmeterAll` on startup and again periodically (hourly is fine).

---

## ⚠️ Account-specific caveats — read before integrating

### 1. Meter 2-2 (ID 223904) was installed mid-day 2026-05-18
- **2026-05-18: 124.2 kWh** is a **partial-day** figure — meter came online around noon. Do NOT use as a baseline.
- First full-day reading: **2026-05-19 = 285.6 kWh**.
- Any daily-baseline / week-over-week / trend calculation should **start from 5-19 onward** for this meter and treat 5-18 as the install date.

### 2. Realtime endpoint may report only phase A early on
On 2026-05-19 morning the realtime snapshot returned `ValueA: 236.1V` and B/C null, even though the 15-min chart showed all three phases. By 2026-05-20 it reports all three normally. For new meters, expect partial population for the first day. Always cross-check with the chart endpoint if the realtime snapshot looks incomplete.

### 3. Values are strings
All numeric values (`ValueAP`, `ValueA/B/C`, `Total`, etc.) come back as strings — `"5.874"`, `"236.1"`. Always `parseFloat` / `float(...)` before doing math.

### 4. `endTime` must not be empty
For Summary/Page/Chart endpoints, sending `endTime: ""` returns HTTP 500. Always send a valid date matching the `dateType` format.

### 5. Power-factor is often null
For most of this account's meters, the PF block returns all nulls. Don't display "0" or "N/A" — show nothing or hide the PF widget.

### 6. Mist sprayer (高压喷雾, ID 166311) toggles offline
Has gone `LineState: 0` then back to `1` between sessions. Don't treat the offline state as data corruption; it's expected for that device.

### 7. Token expires silently on the client
You'll get a successful HTTP 200 with `IsSuccess:false`, `ErrorCode:"401"`, `ErrorMsg:"Token已过期,请重新登录"`. Don't rely on HTTP status alone — check `wrapper.IsSuccess`.

---

## Integration patterns

### Polling strategy

The device transmit cadence (set in our account) is **1 minute per meter**. So the data on the platform refreshes at most once per minute per meter. There's no value in polling faster.

```
Realtime cards:     every 30–60 s,  call AmmeterData_Summary per meter
Today's-total tile: every  60 s,    call SummaryYGDL dateType=D  for each meter
Intraday chart:     every  60 s,    call ChartYGGL dateType=mi15
Daily breakdown:    on-demand only
Historical chart:   on-demand only
```

For N=11 meters that's ~22 requests/min total. The platform handles it; the user's UI does similar.

### Caching / latency-hiding

The Summary/Chart endpoints aren't free server-side. Cache results in your app for 30 s for realtime and 5–10 min for daily/monthly totals. Daily totals don't change retroactively.

### Token refresh policy

```
on every response:    store wrapper.Token (it rotates)
on ErrorCode "401":   redo captcha+login, then retry the original request
on connect / start:   if you have a stored token, try it once; on 401, redo login
```

The token's exp is refreshed on each call — a continuously-polling backend never needs to redo the captcha.

### Don't ship credentials to the browser

For a public-facing app, put the login flow on a server (Cloudflare Worker, a tiny backend) and let the browser talk to your server, not to nh2api directly. Even though CORS is open, the captcha doesn't OCR cleanly in the browser and you don't want `yncn2000` in client-side JS.

For a private internal app accessed by trusted users only, browser-direct is fine — show the captcha image once at login, store the token in `sessionStorage`, refresh on 401.

---

## File reference (when something looks off)

These are the live SPA files we reverse-engineered. Re-fetch fresh copies if behavior diverges:

- `https://nh2.yunjichaobiao.com/config.js` — `hostConfig.apiHost` and the demo project list
- `https://nh2.yunjichaobiao.com/js/common.js` — full `yjAPI` endpoint map (712 names) + `yjAjax` wrapper with `Authorization: Bearer` setup
- `https://nh2.yunjichaobiao.com/js/login.js` — captcha `draw()`, login submit, `randomWord(12)` keyStr generator
- `https://nh2.yunjichaobiao.com/js/toolkit.js` — date helpers (`getTime("D"/"M"/"Y")`), util fns
- `https://nh2.yunjichaobiao.com/Energy/ygdl.html` + `/js/Energy/ygdl.js` — canonical Summary/Chart/Page param shapes for the YGDL endpoints (mirrored for every other metric)
