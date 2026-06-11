# 好队友 Backend

Zero-dependency Node.js backend that turns the front-end into a real
multi-tenant SaaS: accounts, organizations, role-based access, server-side
persistence, an audit trail, and a REST API. No `npm install` required.

## Run

```bash
node server/server.js
# → 好队友 server on http://localhost:8787
```

Open **http://localhost:8787** — the server serves the `/web` UI *and* the API
from the same origin, so the app auto-connects. First visit shows a
login/signup screen; signing up creates your organization (you become owner).

### Config
- `PORT` — listen port (default `8787`)
- `HDY_DATA_DIR` — where JSON data files live (default `server/data`)

## Architecture

| File | Role |
|------|------|
| `server.js` | HTTP server: REST API + static file serving |
| `store.js`  | Atomic JSON file store (swap for Postgres later) |
| `auth.js`   | scrypt password hashing + HMAC-signed session tokens |

Data is multi-tenant: every row carries an `orgId`, and all queries are scoped
to the caller's org. Auth is a stateless signed bearer token (30-day expiry).

### Roles (RBAC)
- **owner** — everything
- **admin** — design, manage, approve, submit, invite, view
- **member** — submit, approve, view
- **viewer** — view only

## API (all under `/api`, JSON, `Authorization: Bearer <token>`)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/auth/signup` | Create org + owner, returns token |
| POST | `/auth/login` | Returns token |
| GET  | `/me` | Current user, org, role |
| GET/PUT | `/config` | Get/save the org's form + approval flow |
| GET/POST | `/documents` | List / create submitted documents |
| PUT/DELETE | `/documents/:id` | Update / delete a document |
| GET/POST | `/members` | List / invite team members |
| GET | `/audit` | Recent audit log (admins) |

## How the front-end connects

`web/sync.js` bridges the existing localStorage UI to this API:
- Pages keep using localStorage (fast, offline-friendly).
- When signed in, config + documents mirror to the server; the shell pulls
  fresh org data every 15s.
- On static hosting with **no** backend, the app stays in local demo mode.

## Production checklist (not yet done — see ROADMAP)
- [ ] Move storage to Postgres (the `store.js` interface is the seam)
- [ ] Real-time push (WebSocket/SSE) instead of 15s polling
- [ ] Email-based invites + password reset
- [ ] Rate limiting, HTTPS/TLS termination, security headers
- [ ] Billing/plans, per-seat limits
