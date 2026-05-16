# Yigrow weather-station dashboard — handoff

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
