# ERP / Work-OS Patterns — Research & Roadmap

Distilled signature strengths of leading platforms, and how 好队友 maps to them.
Goal: borrow the *proven patterns*, not clone any product. Honest status flags:
**✅ have · 🟡 partial · 🔭 roadmap (needs backend)**.

> Reality check: Salesforce / SAP / Monday are each thousands of person-years.
> This is the pattern playbook we build toward — not a promise to match them.

---

## 1. Salesforce — *CRM & pipeline*
**Signature strengths**
- **Pipeline / opportunity stages**: records move through defined stages
  (Prospecting → … → Closed Won/Lost); pipeline is the core mental model.
- **Kanban pipeline view** — drag deals between stages.
- **Forecasting & roll-ups** by rep / team / region; AI flags at-risk deals.
- **Automation (Flow)**: trigger stage changes / field updates on conditions.
- **Validation rules** keep data clean at each stage.

**好队友 mapping**
- Stage/status model → 🟡 we have approval status + choice fields (a "stage" is
  just a select field). **Kanban view → ✅ (this update).**
- Roll-up forecasting → 🟡 dashboard group-by sum/avg exists; per-owner roll-ups 🔭.
- Automation/validation → 🟡 approval condition-branches are a primitive of this; full trigger engine 🔭.
- Sources: [Salesforce pipeline](https://www.salesforce.com/sales/pipeline/management/), [opportunity stages guide](https://ascendix.com/blog/salesforce-opportunity-stages/)

## 2. Monday.com — *Work OS*
**Signature strengths**
- **Multiple board views** on one dataset: Kanban, Calendar, Timeline/Gantt,
  Workload, Chart.
- **30+ column types** (status, timeline, people, formula, …).
- **No-code automation**: "if-this-then-that" rules; 400+ templates.
- **Dashboards**: 20+ widgets pulling from multiple boards.

**好队友 mapping**
- Multiple views → **Kanban + Calendar ✅ (this update)**; Timeline/Gantt 🔭.
- Column/field types → ✅ **56 field types** already (exceeds Monday's ~30).
- No-code automation → 🔭 (highest-value roadmap item; see §6).
- Dashboards/widgets → 🟡 KPIs, donut, trend, group-by chart exist.
- Sources: [Monday features](https://stackby.com/blog/monday-com-features/), [Kanban view](https://support.monday.com/hc/en-us/articles/360000661379-The-Kanban-View)

## 3. SAP — *enterprise ERP*
**Signature strengths**
- **End-to-end process integration**: Procure-to-Pay, Order-to-Cash — no
  re-keying across steps.
- **Master data** (Business Partner): one record for customer/vendor/material,
  reused everywhere → the heart of relational ERP.
- **Three-way match** (PO ↔ goods receipt ↔ invoice) before payment.
- **Approval thresholds, role-based access, traceable changes** (compliance/audit).

**好队友 mapping**
- Master data / relational core → 🔭 **the #1 gap** (we have one flat form;
  need multi-table apps + linked records). Designed *with* the backend.
- Process chains (P2P/O2C) → 🔭 (built as templates once relational core lands).
- Approval thresholds → ✅ condition branches already do threshold routing.
- Role-based access + audit → 🔭 (org/permissions model + audit log).
- Sources: [SAP modules guide](https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/exploring-sap-erp-a-complete-guide-to-key-modules-and-business-processes/ba-p/14097378), [O2C](https://community.sap.com/t5/technology-blog-posts-by-members/sap-order-to-cash-otc-process-detailed-explanation-with-real-time-example/ba-p/14066523)

## 4. Airtable / Notion — *relational no-code DB*
**Signature strengths**
- **True relational model**: bases → tables → **linked records** (foreign keys).
- **Lookup & rollup** fields aggregate across relations (sum invoices per client).
- **Multiple saved views** per table (grid/kanban/calendar/gallery/timeline),
  each with own filter/sort/**group**.
- Rich field types (25+).

**好队友 mapping**
- Relational/linked records/lookup/rollup → 🟡 field *types* exist in the palette,
  data layer 🔭 (needs backend).
- Multiple views + grouping → **Kanban/Calendar ✅**, saved views ✅ (grid),
  grouping in grid 🔭.
- Sources: [Airtable vs Notion](https://aiproductivity.ai/blog/airtable-vs-notion-databases/), [Airtable timeline grouping](https://support.airtable.com/docs/timeline-view-grouping)

---

## 5. The cross-platform "greatest hits" (what actually recurs)
1. **Multiple views on one dataset** (Kanban/Calendar/Timeline) — *universal*.
2. **Relational data + rollups** — Airtable & SAP's backbone.
3. **No-code automation** (triggers → actions) — Monday & Salesforce.
4. **Dashboards/forecasting roll-ups**.
5. **Master data reused across processes** (SAP).
6. **Audit trail / role-based access** (enterprise table-stakes).

## 6. Prioritized roadmap for 好队友
| Pri | Capability | Why | Status |
|-----|-----------|-----|--------|
| P0 | **Kanban + Calendar views** | universal, high-demo, no backend | ✅ this update |
| P0 | **Relational core** (multi-table apps, linked/lookup/rollup) | the ERP backbone | 🔭 design w/ backend |
| P1 | **No-code automation engine** (trigger→condition→action) | Monday/SF signature | 🔭 |
| P1 | **Org/roles + row-level permissions + audit log** | enterprise table-stakes | 🔭 |
| P2 | **Timeline/Gantt + workload views** | project mgmt | 🔭 |
| P2 | **Process templates** (P2P, O2C, CRM pipeline) | ship value on the platform | 🔭 |
| P3 | **Forecasting roll-ups, multi-currency, i18n** | scale/enterprise | 🔭 |

**Recommended next:** the **relational core + automation engine**, both designed
into the backend schema from day one (cheap now, expensive to retrofit).
