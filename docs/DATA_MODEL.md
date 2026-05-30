# Data Model & Sync Contract

How the modules stay coherent and in sync. All data lives in `localStorage` on
one origin; every module reads/writes the **same keys** and reacts to changes
through a shared sync bus. (This is the contract the backend will implement 1:1.)

## Storage keys (single source of truth)
| Key | Owner concept | Written by | Read by |
|-----|---------------|-----------|---------|
| `hdy.formbuilder.v1` | Form schema (fields) | form designer | all |
| `hdy.flow.v1` | Approval flow definition | flow designer | app, manage |
| `hdy.instances.v1` | Submitted records (documents) | app, manage, views | all |
| `hdy.notif.v1` | Notifications | app, manage | app, shell |
| `hdy.user.v1` | Current identity | shell, app | all |
| `hdy.seq.v1` | Per-field serial counters (流水号) | app | app |
| `hdy.views.v1` | Saved table views | manage | manage |
| `hdy.viewmode.v1` | Kanban/Calendar settings | views | views |
| `hdy.dash.v1` | Dashboard group-by config | dashboard | dashboard |
| `hdy.sync` | **Sync ping** (value = timestamp) | every mutation | every module |

## Instance (document) shape
```
{ id, no, title, data:{<fieldKey>:value}, initiator, createdAt,
  status:'running'|'approved'|'rejected', cursor, resubmittedAt?,
  steps:[ { kind:'approval'|'cc'|'branch', name, rule, perms,
            assignees:[], status, actedBy?, comment?, actedAt? } ] }
```
- `no` = human document number from the first 流水号 field (ERP-style).
- `steps` is a **snapshot** compiled from the flow at submit/resubmit time, so a
  later flow edit never rewrites history.

## Sync bus (why modules stay live)
Modules run inside the shell as **iframes**. `window.focus` does NOT fire on
tab-switch between sibling iframes, so we use the browser's `storage` event:

1. A module mutates data → writes its key(s) → calls `bumpSync()` which sets
   `hdy.sync` to a new value.
2. The `storage` event fires in **every other same-origin document** (sibling
   iframes + the shell).
3. Each listener re-reads from storage and re-renders. The shell refreshes the
   overview + 待办 badge; manage refreshes unless an editor drawer is open.

Result: approve in 待办 → the 看板 column, 数据看板 KPIs, 数据管理 table and the
overview all update without a manual refresh.

## ERP coherence rules
- **Document numbering**: 流水号 fields auto-fill on submit from `hdy.seq.v1`,
  zero-padded with the field's prefix; numbers are monotonic and never reused.
- **History is immutable**: approval `steps` are snapshotted; editing the flow
  only affects *future* submissions and explicit resubmits.
- **Status is owned by the flow**: Kanban can group by status but can't drag it;
  only approve/reject/resubmit change `status`.
- **One identity** (`hdy.user.v1`) drives both "who submits" and "who approves",
  shared across shell + app.

## Roadmap note (backend)
Replace localStorage with API + DB tables mirroring these keys; replace the
`storage` bus with WebSocket/SSE push. The shapes above are the migration spec.
