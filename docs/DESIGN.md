# 好队友 → Own Low-Code SaaS — Design & Spec

Working spec for rebuilding **好队友** as an independently-owned low-code SaaS
platform. **Fill in the blanks below, or paste exported Yida JSON** — this
replaces "explaining everything" and becomes the spec the code is built from.

> Source of truth = things you legitimately own: your Yida **form/app exports**,
> data exports, and your own knowledge of the app. No platform reverse-engineering.

---

## 0. How to fill this in fast
- Replace each `<...>` with your answer, or delete what doesn't apply.
- You can **paste raw exported JSON** (Yida form definitions / data export) under
  the relevant section — it'll get parsed into a proper schema.
- Bullet points are fine. Don't polish.

## 1. Product overview
- One-liner: `<what 好队友 does>`
- Primary users: `<who uses it — teams? managers? field staff?>`
- Core problem solved: `<...>`
- Where it runs: `<web / embedded-in-DingTalk / mobile / all>`

## 2. Users & roles (RBAC)
| Role | Can do | Cannot do |
|------|--------|-----------|
| `<admin>` | | |
| `<member>` | | |
| `<...>` | | |

## 3. Core data objects ("forms" / models)
List the main entities and their fields. **Paste Yida form export JSON here if you
have it** and skip the manual tables.

### Object: `<e.g. Project>`
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `<name>` | `<text/number/date/select/relation/...>` | `<y/n>` | |

### Object: `<e.g. Task>`
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| | | | |

## 4. Workflows / automation
Describe each key flow as **trigger → conditions → actions**.
- Flow 1: `<e.g. submit request → manager approves → auto-assign owner → notify>`
- Flow 2: `<...>`

## 5. Views / pages
- `<list views, detail forms, dashboards, kanban, calendar, etc.>`

## 6. Integrations
- [ ] **DingTalk login (OAuth)** — legitimate SSO/login provider
- [ ] Notifications (DingTalk bot / webhook)
- [ ] Data import/export (Excel/CSV)
- [ ] Other: `<...>`

## 7. Platform architecture (the low-code engine)
Proposed defaults — edit freely:
- **Metadata store** — app / model / field / view all defined as JSON
- **Visual builder** — drag-and-drop form & view designer
- **Runtime renderer** — turns schema → live UI
- **Workflow engine** — trigger / condition / action
- **Multi-tenancy** — `<single org first? or multi-tenant from day 1?>`
- **Datastore** — `<Postgres (recommended) / MySQL / ...>`

## 8. Tech stack (decide after §1–7)
Candidates (pick later):
- Next.js + PostgreSQL (TypeScript end-to-end)
- React SPA + NestJS + PostgreSQL
- Vue 3 + Spring Boot (closer to the DingTalk/enterprise ecosystem)

## 9. Open questions
- `<anything you're unsure about>`
