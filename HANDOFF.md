# Greenhouse dashboard — reverse-engineering handoff

Two unrelated greenhouse-control platforms reverse-engineered for a future session to build simple realtime dashboards. Each platform is independently documented below.

- **Platform A — Yigrow** (`v2.yigrow.cn`): single external weather station, MQTT-over-WSS live stream, **CORS open** → pure browser-side dashboard is feasible.
- **Platform B — 0531 综合环境监控云平台** (`www.0531yun.com`): per-greenhouse sensors (temp/humi/light) across 7 sheds, plain WebSocket push + REST polling, **captcha login + CORS locked** → needs a small backend/proxy.

---

# Platform A — Yigrow weather-station

Reverse-engineered notes for a future session to build a simple realtime HTML dashboard against the Yigrow greenhouse-control platform (`v2.yigrow.cn`).

## Goal

A single static HTML page (no backend needed — CORS is wide open) that logs into the Yigrow API, then displays the external weather-station data live. Initial values come from a one-shot REST call; subsequent updates stream over MQTT-over-WebSockets.

## Credentials

- Username: `18787195626`
- Password: `YNCN2000`
- Account is admin of base (`bisId`) `69265a54541d85c7e4e8ae72`.

## Hosts

| Purpose | URL |
|---|---|
| SPA (original UI, for reference) | `https://v2.yigrow.cn` |
| REST API base | `https://v2024.yigrow.cn` |
| MQTT-over-WSS broker | `wss://brokerV2.yigrow.cn:443/mqtt/` |

CORS on the REST API: `Access-Control-Allow-Origin: *`, allowed headers include `Authorization`, `Content-Type`, `TENANT-ID`. A browser page on any origin can call it directly.

## Authentication

### Login (GET with query params — not POST)
```
GET https://v2024.yigrow.cn/v1/token/user/login?username=18787195626&password=YNCN2000
```
Response (truncated):
```json
{
  "accessToken": "eyJhbGci...",     // JWT, exp ~12h (43200s) from iat
  "refreshToken": "eyJhbGci...",    // JWT, exp ~120d from iat
  "uid": "69257ae9541d85c7e4e88e42",
  "bisId": "69265a54541d85c7e4e8ae72",
  "username": "18787195626",
  "role": ["管理员"],
  ...
}
```

### Authenticated requests
Send the raw `accessToken` as the `Authorization` header. **No `Bearer ` prefix** — the SPA sends the token verbatim:
```
Authorization: <accessToken>
```

### Token refresh (when access token returns HTTP 401)
```
GET https://v2024.yigrow.cn/v1/token/refresh?refreshToken=<refreshToken>
```
Response includes a new `accessToken`. The SPA queues failing requests, refreshes, then retries.

## REST endpoints used by the dashboard

### List all devices (one-shot, gets current snapshot)
```
GET https://v2024.yigrow.cn/v1/device/all
Authorization: <accessToken>
```
Returns an array. The weather station entry:
```json
{
  "_id": "6870a344668b89b3c9b93d61",
  "id":  "6870a344668b89b3c9b93d61",
  "sn":  "000520250711000001",
  "name": "气象站",
  "title": "4g气象站0001",
  "productType": "sensor",
  "deviceType": "sensor",
  "online": 1,
  "bisId": "69265a54541d85c7e4e8ae72",
  "attribute": {
    "temp": 17.1, "humi": 73, "illu": 0, "uv": 0,
    "windSpeed": 2, "windPosition": 3, "rainfall": 0,
    "devBat": 4200, "devCSQ": 4, "devVin": 0, "bat": 1
  },
  "updatedAt": "2026-05-16T15:25:56.021Z"
}
```
Filter to the weather station with `name === "气象站"` (or `title.includes("气象站")`). The account currently has exactly **one** weather station; the dashboard should still iterate so multi-station setups Just Work.

### Historical chart data (optional, for a "last 24h" line chart)
```
GET https://v2024.yigrow.cn/v1/device/history?id=<deviceId>&sn=<deviceSn>&type=table&start=<startMs>&end=<endMs>
Authorization: <accessToken>
```
- `start` / `end` are epoch **milliseconds**.
- **`type=table` is the easier mode for a dashboard** — returns an array of full attribute snapshots (newest-first) with ISO-8601 timestamps and raw native units (matches `/v1/device/all`):
  ```json
  [
    {"t":"2026-05-16T15:25:56.022Z","temp":17.1,"humi":73,"illu":0,"uv":0,
     "windSpeed":2,"windPosition":3,"rainfall":0,
     "devBat":4200,"devCSQ":4,"devVin":0,"bat":1},
    ...
  ]
  ```
- `type=chart` (and identical `type=raw`) returns a **pre-serialized ECharts shape** with a separate `t` series of epoch-ms timestamps and per-sensor `data` arrays — useful only if you're feeding ECharts directly. **Note:** chart mode applies display scaling (e.g. `devBat` becomes 42 = 4.2 V, `windSpeed` is dm/s integer, `windPosition` is pre-decoded to the Chinese label string). Stick with `type=table` unless you need the ECharts shape.
- A 24h window returned ~284 rows (~one every ~5 minutes for history).

## Live updates — MQTT over WebSockets

The SPA streams realtime sensor values from the broker. Use this for live dashboard updates (the device publishes every ~30–60s).

**Connection:**
- URL: `wss://brokerV2.yigrow.cn:443/mqtt/` (the trailing `/mqtt/` path is required)
- MQTT username = login response's `uid`
- MQTT password = login response's `accessToken`
- ClientId: `${uid}-${random6chars}` (any unique string works; this is just the SPA's convention)
- Protocol: MQTT v3.1.1

**Topic to subscribe (use the EXACT topic — no wildcards):**
```
spu/<sensorSn>/state/sensor
```
For this account's weather station: `spu/000520250711000001/state/sensor`.

**⚠️ Critical gotcha:** the broker's ACL **rejects wildcard subscriptions** (`spu/+/state/sensor`, `spu/#`). When the SUBSCRIBE contains a wildcard the broker SUBACKs only the allowed topic and **immediately drops the connection**, causing reconnect loops with no messages delivered. Always subscribe to fully-qualified topics — one SUBSCRIBE per device.

**Verified live payload (received during testing):**
```json
{
  "id": "6870a344668b89b3c9b93d61",
  "deviceType": "sensor",
  "t": 1778945764015,
  "temp": 17.3, "humi": 72,
  "illu": 0, "uv": 0,
  "windSpeed": 1.7, "windPosition": 3,
  "rainfall": 0,
  "bat": 1, "devBat": 4200, "devVin": 0, "devCSQ": 4
}
```
`t` is epoch milliseconds. Fields match the REST `attribute` object, in raw native units (no scaling applied — same as `type=table`).

**Browser client:** use [mqtt.js](https://github.com/mqttjs/MQTT.js) via the CDN build (`https://unpkg.com/mqtt/dist/mqtt.min.js`). Example connect:
```js
const client = mqtt.connect('wss://brokerV2.yigrow.cn:443/mqtt/', {
  clientId: `${uid}-${Math.random().toString(36).slice(2, 8)}`,
  username: uid,
  password: accessToken,
  protocolVersion: 4,        // MQTT 3.1.1
  clean: true,
});
client.on('connect', () => client.subscribe(`spu/${sn}/state/sensor`));
client.on('message', (topic, buf) => {
  const msg = JSON.parse(buf.toString());
  // update UI fields here
});
```

## Sensor field reference

Sourced from `/tmp/yigrow/sensor-utils-BeZXe9ES.js` in the verified session. English labels are canonical translations (the bundle's English i18n only covers UI chrome — sensor field labels exist only in Chinese in the SPA).

| Key | Chinese | English | Unit (live + `type=table`) | Notes |
|---|---|---|---|---|
| `temp` | 空气温度 | Air Temperature | °C | |
| `humi` | 空气湿度 | Air Humidity | % | |
| `illu` | 光照强度 | Illuminance | lux | aliases `ilux`, `lux`. History `chart` mode reports in klx (×1000). |
| `uv` | 紫外线 | UV Radiation | W/m² | History `chart` mode is ×0.1 (i.e. divide). |
| `windSpeed` | 风速 | Wind Speed | m/s | History `chart` is integer dm/s. |
| `windPosition` | 风向 | Wind Direction | enum 0–7 | See compass table below. History `chart` mode pre-decodes to Chinese string; `table` mode and MQTT keep the int. |
| `rainfall` | 降雨量 | Rainfall (cumulative) | mm | Cumulative, not per-interval rate. |
| `devBat` | 电池电压 | Device Battery Voltage | mV | 4200 = 4.20 V. History `chart` divides by 100. |
| `devCSQ` | 信号强度 | Signal Strength (GSM CSQ) | unitless 0–31 | Standard cellular signal-quality scale. |
| `devVin` | 充电电压 | Charging Voltage | mV | 0 when not charging. |
| `bat` | 电池电量 | Battery Level | % (0–100) | Sample value `1` looked suspicious — may be raw and need normalization at runtime. |

### `windPosition` decode (8-point compass, N=0 going clockwise)
| 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| 北风 / N | 东北风 / NE | 东风 / E | 东南风 / SE | 南风 / S | 西南风 / SW | 西风 / W | 西北风 / NW |

Any other integer → render as `Unknown` / `未知`.

## What the dashboard should do (suggested shape)

1. On page load: prompt for (or hard-code) the username/password, call the login endpoint, stash `uid`, `accessToken`, `refreshToken` in `localStorage`.
2. Call `GET /v1/device/all`, find the weather-station device (`name === "气象站"`), display its `attribute` snapshot as cards (temp, humidity, wind, etc.).
3. Optionally call `GET /v1/device/history?type=table&start=...&end=...` for a 24h trend chart.
4. Connect to `wss://brokerV2.yigrow.cn:443/mqtt/` with `username=uid, password=accessToken`, subscribe to `spu/<sn>/state/sensor`, and update the card values on each incoming message.
5. On HTTP 401 from any REST call, hit `/v1/token/refresh?refreshToken=...` and retry.
6. Reconnect MQTT on disconnect; refresh the token first if the disconnect reason was "Not authorized" (the broker authenticates against the JWT).

## Other endpoints in the bundle (not needed for v1, for future reference)

Discovered API prefixes (all under `https://v2024.yigrow.cn`):
`/v1/token`, `/v1/user`, `/v1/user-bis`, `/v1/bis`, `/v1/category`, `/v1/group-yi`, `/v1/product-yi`, `/v1/device`, `/v1/wx`, `/v1/quick-icons`, `/v1/report/error`.

Other potentially useful device routes (from `device-api-D6sQ1VYy.js`):
- `GET /v1/device/allNewData` — devices grouped by system
- `GET /v1/device/page` — paginated by type
- `GET /v1/device/tree` — grouped by zone
- `GET /v1/device/all-attribute`, `/v1/device/write-attribute` — attribute schemas

There are also routes for alarms (`/v1/...weather-alarm-set`, `/v1/...sensor-alarm-set`) if the dashboard ever needs threshold/alert config.

---

# Platform B — 0531 综合环境监控云平台 (www.0531yun.com)

Reverse-engineered notes for a future session to build a realtime dashboard showing per-greenhouse environmental data (温度 / 湿度 / 光照 / 电量) for "昆明统一生物科技有限公司" (Kunming Tongyi Biotech). 7 greenhouses currently registered (`7号棚`, `8号棚`, `9号棚`, `长松园1号棚`–`长松园4号棚`).

## Goal

A dashboard showing live air-temp / humidity / light / battery / power-state per greenhouse. Realtime push is available via a custom WebSocket, but sensors only publish every ~10 minutes (`savedatainterval: 10` in the device config), so a 60-second polling fallback is what the official UI relies on most of the time.

## Credentials

- Username: `h250512kmty`
- Password: `h250512kmty`
- Account is `userType: 2` (multi-greenhouse subaccount).

## Hosts

| Purpose | URL |
|---|---|
| Web UI + REST API (same origin) | `https://www.0531yun.com` |
| WebSocket push | `wss://www.0531yun.com/websocket/<userId>` |
| Camera service (not used by this dashboard) | `https://www.0531yun.com/cameracenter` |

## ⚠️ Critical constraints (read this first)

These are the two things that mean **this dashboard cannot be a pure browser-side static page** — it needs a small backend or proxy.

### 1. CORS is locked down
The REST API rejects cross-origin requests:
- OPTIONS preflight from any non-yun origin → **HTTP 403** with no `Access-Control-*` headers.
- No `Access-Control-Allow-Origin: *`.

A browser dashboard hosted anywhere other than `www.0531yun.com` cannot call the API directly. **Mitigation:** run a tiny backend (Node/Python/Cloudflare Worker) that holds the session cookie, calls the upstream API, and serves the results to the front-end with permissive CORS — or render the dashboard server-side.

### 2. Login requires a captcha
Login flow:
1. `GET /` once to seed a `SESSION` cookie (HttpOnly, set on landing).
2. `GET /sysUser/verifyCode?time=<epoch_ms>` — returns a 100×18 JPEG, 4-char captcha. The captcha is bound to the session cookie.
3. Solve the captcha (OCR is feasible — characters are simple alphanumerics on light noise; or have a human type it).
4. `POST /sysUser/userLogin` (form-urlencoded body) with `loginName`, `loginPassword`, `code` → success returns `{code:1000, data:{userId, userName, loginName, userType, ...}}` and refreshes the same `SESSION` cookie. Cookie now authenticates all subsequent calls.

The captcha is the main automation pain. Realistic approach for a dashboard:
- **Cheapest:** show the captcha image in the dashboard UI, ask the operator to type it on first launch; cache the session cookie.
- **More autonomous:** plug in tesseract or a small CNN classifier on the JPEG (4-char captchas of this style usually OCR at ~80–90 %; retry on failure).
- **Most reliable:** allow the operator to log in once and paste the `SESSION` cookie into the backend's config; refresh manually when it expires.

There's also a `/sysUser/trialUserLogin` endpoint (no creds, no captcha — used by the "演示账号登录" / Demo Account button on the homepage) that returns a working session for a demo account. Not useful for this account's real data, but handy for testing the post-login API surface.

## Auth & session

- Auth carrier: **`SESSION` cookie** (HttpOnly, set by nginx; value is base64-ish). Send it with every REST call (`Cookie: SESSION=...`).
- No bearer tokens, no JWT. All endpoints are cookie-authed.
- `userId` from the login response is what you use in the WebSocket URL — store it alongside the session cookie.
- Session lifetime: sliding window (server-side Spring session by the look of it); expect to re-login if the user is idle for ~30 min, and definitely on next-day startup.
- The login response also includes a `checkCode` field — not seen used by any later endpoint inspected so far; ignore unless something later breaks.
- One nginx quirk: REST JSON responses are prefixed with a **UTF-8 BOM** (`\xef\xbb\xbf`). Strip it before `JSON.parse` or use a lenient parser (`json.loads(body.lstrip('﻿'))`).

## REST endpoints used by the dashboard

All paths are relative to `https://www.0531yun.com`. All return `{code, message, data}`. Success is `code == 1000`. `code == 2000` means session expired → re-login.

### Login + session setup
```
GET  /                                            # one-shot, sets SESSION cookie
GET  /sysUser/verifyCode?time=<epoch_ms>          # returns image/jpeg captcha
POST /sysUser/userLogin                           # form-urlencoded
  loginName=<user>&loginPassword=<pwd>&code=<captcha>
GET  /sysModule/getSysModule                      # menu (optional; lets you discover available modules per account)
```

### Device list + snapshot
```
GET /device/userDevicesCount                      # returns {data: <int count>}
GET /sysData/getRealTimeData                      # full snapshot — what the dashboard polls every 60s
GET /sysData/getRealTimeDataByPage?pageIdx=1&queryNum=100   # paginated snapshot (UI uses this when account has >300 devices)
GET /device/userDevices                           # device metadata (name, addr, group)
GET /device/deviceWithEnabledFactorsByDeviceAddr?deviceAddr=<int>   # factor (sensor) catalog for one device
```

#### `getRealTimeData` response shape (verified)
Array of device snapshots. Each device:
```json
{
  "systemCode": "iot",
  "deviceAddr": 21100849,           // numeric device id, also used as the "id"
  "deviceName": "7号棚",
  "deviceStatus": "normal",          // "normal" | "offline" | etc.
  "lat": 0.0, "lng": 0.0,            // 0 if unset; otherwise BD-09, see "Coordinates" gotcha
  "relayStatus": "[{\"relayNo\":1,\"relayStatus\":0}, ...]",   // JSON-encoded STRING, 16 relays
  "dataItem": [
    {
      "nodeId": 1,
      "registerItem": [
        { "registerId": 1, "registerName": "7号棚#空气温度A",
          "data": "17.5", "value": 17.5, "unit": "℃",
          "alarmLevel": 0, "alarmColor": "ff0000", "alarmInfo": "" },
        { "registerId": 2, "registerName": "7号棚#空气湿度A",
          "data": "96.1", "value": 96.0999984741211, "unit": "%RH" ... }
      ]
    },
    { "nodeId": 2, "registerItem": [ { "registerId": 5, "registerName": "...光照强度A", "unit": "Lux", ... } ] },
    { "nodeId": 5, "registerItem": [ { "registerId": 1, "registerName": "电池电量", "unit": "%", ... } ] },
    { "nodeId": 6, "registerItem": [ { "registerId": 1, "registerName": "供电状态",
                                       "data": "外部电源供电", "value": 0.0, "unit": "" } ] }
  ],
  "timeStamp": 1778967456203          // epoch ms
}
```

Structure: **device → nodes (sensor modules) → registers (individual measurements)**. For a value pick `registerItem[].value` (numeric) or `data` (formatted string with the right precision). `alarmLevel > 0` means an active alert and `registerItem[].alarmInfo` holds the message.

#### Per-account sensor inventory (this user, 7 devices)
Every greenhouse exposes the same 5 registers:
| Node | Register | Name | Unit |
|---|---|---|---|
| 1 | 1 | `<棚名>#空气温度A` (Air Temperature) | ℃ |
| 1 | 2 | `<棚名>#空气湿度A` (Air Humidity) | %RH |
| 2 | 5 | `<棚名>#光照强度A` (Illuminance) | Lux |
| 5 | 1 | 电池电量 (Battery Level) | % |
| 6 | 1 | 供电状态 (Power Supply Status) | enum text (e.g. `外部电源供电` = mains, `电源供电` = grid) |

No outdoor weather station on this account — purely indoor per-greenhouse sensors. The 16-relay `relayStatus` is for vent / pump / heater control (out of scope for a read-only dashboard but available).

### Historical data
```
GET /sysData/multicolumnHistory?deviceAddr=<int>&factorIds=<csv>&startTime=<epoch_ms>&endTime=<epoch_ms>
```
- `factorIds` format is **`<deviceAddr>_<nodeId>_<registerId>`**, comma-separated (e.g. `21100849_1_1,21100849_1_2` for shed 7's temp + humidity).
- Time range **must not exceed 31 days** (UI enforces; server probably rejects too).
- Get the factor catalog first via `/device/deviceWithEnabledFactorsByDeviceAddr?deviceAddr=<addr>` — that returns `{data: {factors: [{factorId, nodeId, registerId, factorName, unit, coefficient, ...}]}}`.

Response shape:
```json
{
  "code": 1000,
  "data": {
    "fieldInfo": {
      "1_1": { "columnText": "7号棚#空气温度A", "nodeId": 1, "minValue": 17.5, "maxValue": 17.7, "avgValue": 17.62 }
    },
    "dataCollectionList": [
      { "historyIds": ["..."], "deviceAddr": 21100849, "deviceName": "7号棚",
        "dataMap": { "1_1": { "registerId": 1, "value": 17.7, "text": "17.7", "alarmLevel": 0, "registerName": "7号棚#空气温度A" } },
        "lat": 0.0, "lng": 0.0,
        "recordTime": 1778964147003 },
      ...
    ]
  }
}
```
- `recordTime` is epoch ms.
- `dataMap` keys are `<nodeId>_<registerId>` (note: NOT prefixed by deviceAddr inside the map, even though the request param is).
- Sample cadence reflects `savedatainterval` — 10 min for this account → roughly 6 rows per hour per factor.

## Real-time push — WebSocket

```
URL:      wss://www.0531yun.com/websocket/<userId>
Protocol: plain WebSocket (no STOMP/SockJS handshake despite sockjs.min.js being loaded — the UI does try SockJS as a path but falls back to a plain WS, and that's what the published `socket = new WebSocket(...)` line does)
Origin:   https://www.0531yun.com   (any origin appears to work in testing, but set this to be safe)
Auth:     the userId in the URL is the only identifier — no cookie strictly required for the connection itself, but include the SESSION cookie defensively.
```
The server pushes JSON messages of the form:
```json
{ "dataType": "RealTimeData", "data": { /* same shape as one device entry from getRealTimeData */ } }
{ "dataType": "TransData",    "data": "<json-string payload>" }     // device pass-through
{ "dataType": "DictData",     "data": "<json-string payload>" }     // device-parameter readback
```
On `RealTimeData`, the inner `data.deviceAddr` identifies which greenhouse. `data.firstData` is set on the initial replay (the UI suppresses alarms for those).

**Cadence reality check:** the SDK reconnects-and-polls every 60 s as a fallback regardless. Sensors save every 10 min, so in this account WS messages will arrive at roughly the same cadence — don't expect sub-minute updates. The official UI doesn't either; it just renders whatever it has and updates the timestamps.

## Coordinates gotcha (only relevant if you map devices)

`lat`/`lng` from the API are in **BD-09** (Baidu Maps datum). The UI converts BD-09 → GCJ-02 → WGS-84 before plotting (`default/js/WGS.js`, function `bd09ToGcj02` then `gcj02ToWgs84`). For this account both fields are `0.0`, so this is academic — but be aware if you ever build a map view.

## Suggested dashboard shape

Given the CORS lock + captcha, the simplest shippable design is:

1. **Tiny backend** (Node, Python, or a Cloudflare Worker):
   - First-run setup: hits `/`, fetches a captcha, asks the operator to solve it, posts `/sysUser/userLogin`, stores `SESSION` cookie + `userId` to disk.
   - Auto-relogin loop: if any upstream call returns `code: 2000`, re-prompt for captcha (or retry OCR), refresh the cookie.
   - Polls `GET /sysData/getRealTimeData` every 60 s; caches the latest snapshot.
   - Optionally connects to `wss://.../websocket/<userId>`, merges `RealTimeData` pushes into the cache.
   - Exposes one CORS-permissive `GET /api/snapshot` endpoint (returns the cached JSON) and optionally a WS broadcast for the browser front-end.

2. **Front-end** (static HTML):
   - Polls or WS-subscribes to the backend's `/api/snapshot`.
   - Renders one card per device: temperature, humidity, light, battery, power-state, online/offline badge, last update.
   - Optional: a 24 h line chart per greenhouse using `/sysData/multicolumnHistory` (via a backend proxy endpoint that takes `deviceAddr` + factor list and forwards).

## Other endpoints in the bundle (not needed for v1)

Discovered REST surface (incomplete; for reference):
- `/group/groupListPage`, `/group/getTargetGroup`, `/group/checkTargetGroupAuth`, `/group/defaultDevice`, `/group/surplus`, `/group/rechargeSurplus`
- `/device/deviceListByGroupId`, `/device/userDevices`
- `/deviceOperate/getDict`, `/deviceOperate/writeDict`, `/deviceOperate/getDictIdList`, `/deviceOperate/transData`, `/deviceOperate/getUrl`, `/deviceOperate/callIUrl`
- `/sysData/deviceParamData`, `/sysData/deviceStatusSum`, `/sysData/delHistory`
- `/sysDeviceCamera/enableCameraListByDeviceAddr`, `/rkCamera/api/cameraInfo/getCameraAlarmInfo`
- `/sysUser/currentUpdatePwd`, `/sysUser/surplus`
- `/device/factorAlarmSettingListByDevice` — alarm thresholds per factor
- `/wechat/getBindPcUserQr`, `/wxpay/userpay`

There's also an undocumented anti-rate-limit header used by some routes: `byPassFrequency: GNSS_2012` (see `default/js/ajax.js` `GetData2`). Send it if a particular endpoint starts 429-ing under load.

## Key files (URL paths to grab fresh if anything looks off)

| File | What it contains |
|---|---|
| `default/js/loginAjax.js` | Login flow + captcha refresh |
| `default/js/ajax.js`      | Wrappers (`GetData`, `PostData`, `PostData2`, `GetData2`); `rkCameraUrl` |
| `default/js/websocket.js` | WebSocket connect, `getRealTimeData` polling fallback, `loadLedRealData` paged polling |
| `default/js/homeAjax.js`  | Home page wiring; device-count branch (>300 → speedHome.html, else home.html) |
| `default/js/historyAjax.js` | History query (factorIds CSV, 31-day cap) |
| `default/js/indexAjax.js` | Header / module / alarm setup |
