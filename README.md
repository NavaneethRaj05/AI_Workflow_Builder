# FlowForge — AI Agent Workflow Builder

> **Live App**: [https://ai-workflow-builder-sable.vercel.app](https://ai-workflow-builder-sable.vercel.app)

A mini-n8n purpose-built for chaining AI agent steps. Users inside an organization build multi-step workflows, trigger them multiple ways, and every action is checked against two independent permission layers — one declarative in Hasura, one imperative in serverless function handlers.

Built with **nhost** (PostgreSQL + Hasura + Auth + Functions) and **Next.js 16**.

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                  Next.js (Vercel)                    │
│  Auth · Workflow Builder · Run Monitor (live subs)   │
│  Quota Dashboard · Team Management · Notifications   │
└──────────────────┬───────────────────────────────────┘
                   │ GraphQL queries / mutations / subscriptions
┌──────────────────▼───────────────────────────────────┐
│           Hasura GraphQL Engine (nhost)               │
│  Row-Level Security · Actions · Event Triggers        │
│  Cron Triggers · Computed Fields · WebSocket Subs     │
└─────────┬───────────────────────┬────────────────────┘
          │                       │
┌─────────▼────────┐    ┌─────────▼──────────────────────┐
│  PostgreSQL       │    │    nhost Serverless Functions   │
│  (nhost Cloud)   │    │  triggerWorkflowRun             │
└──────────────────┘    │  approveStep                    │
                        │  webhookIngest                  │
                        │  executePendingRun              │
                        │  scheduledRunner                │
                        │  eventTriggerHandler            │
                        └────────────────────────────────┘
```

---

## Setup & Running Locally

### Prerequisites
- Node.js 18+
- nhost CLI: `npm install -g @nhost/cli`
- Docker Desktop (for local nhost)

### 1. Clone & Install

```bash
git clone <your-repo-url>
cd ai-workflow-builder
npm install --legacy-peer-deps
```

### 2. Configure Environment

```bash
cp .env.local.example .env.local
```

Fill in `.env.local`:
```env
NEXT_PUBLIC_NHOST_SUBDOMAIN=bykigbyxcjykjxbhakqc
NEXT_PUBLIC_NHOST_REGION=ap-south-1
NHOST_ADMIN_SECRET=<from nhost dashboard>
NHOST_WEBHOOK_SECRET=<any random 32+ char string>
GROQ_API_KEY=gsk_...   # free at console.groq.com
```

### 3. Start Frontend

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

To run against local nhost instead of cloud, start `nhost up` first and update the subdomain/region accordingly.

---

## Triggering via Webhook (no UI click)

```bash
curl -X POST https://ai-workflow-builder-sable.vercel.app/nhost/functions/webhookIngest \
  -H "Content-Type: application/json" \
  -d '{
    "trigger_id": "<trigger-uuid-from-workflow-builder>",
    "secret": "<webhook-secret-shown-in-builder>",
    "data": {"event": "test_payload"}
  }'
```

---

## Schema Reasoning

Eight tables covering the full domain:

| Table | Purpose |
|-------|---------|
| `organizations` | Multi-tenant boundary; holds quota counters and reset timestamp |
| `org_members` | role per user per org — the join table that powers all org-scoped permissions |
| `workflows` | Belong to one org; soft-deleted via `is_active` |
| `workflow_steps` | Ordered; each holds a `step_type` enum and a `config` JSONB for type-specific settings |
| `workflow_triggers` | One per workflow; `webhook_secret` stored here for verification |
| `workflow_runs` | One record per execution; `paused_at_step_id` supports the pause/resume gate |
| `step_runs` | One per step per run; tracks `approved_by`, `approved_at`, `approval_comment` for audit |
| `notifications` | Append-only audit log written by `db_write` and `notify` steps |

**Design decisions:**
- `JSONB` for step `config` lets each step type define its own schema without migrations for every new field.
- `workflow_runs.duration_ms` is a `GENERATED ALWAYS AS` computed column — zero application code needed for timing.
- `total_steps` / `completed_steps` on `workflow_runs` are Hasura computed fields backed by SQL functions — the subscription payload includes them without a join, so the progress bar updates live.
- A `quota_remaining` computed field on `organizations` (backed by `get_org_quota_remaining()`) exposes remaining quota as a first-class field in the schema.
- `check_and_increment_quota()` uses `SELECT ... FOR UPDATE` to prevent double-spending quota under concurrent runs.

---

## Two Permission Layers

### Layer 1 — Hasura Row-Level Security (declarative)

Every table that touches org data has a `filter` clause in its Hasura permission that walks the relationship chain back to `org_members`:

```yaml
# Example: workflow_runs select_permission
filter:
  organization:
    org_members:
      user_id: { _eq: X-Hasura-User-Id }
```

This means a user in Org B who guesses a valid Org A UUID gets **zero rows back**, not a 403 — they can't even confirm the resource exists.

For step-level gating, `workflow_steps` insert/update/delete permissions use an `_or` filter:
- `owner` role → any `step_type`
- `editor` role → only `llm_call`, `http_request`, `conditional_branch`, `approval_gate`

This means editors literally cannot save a `db_write` or `notify` step — the Hasura check constraint rejects the insert at the DB level.

### Layer 2 — Action Handler Code (imperative)

`triggerWorkflowRun` and `approveStep` are Hasura Actions backed by serverless functions. Both re-verify org membership and role in application code **after** Hasura forwards the request:

```
triggerWorkflowRun:
  1. Parse caller user ID from session_variables (forwarded by Hasura)
  2. Fetch workflow → get org_id
  3. getUserOrgRole(callerId, workflow.org_id) → must be owner/editor
  4. Check quota
  5. Create run, execute

approveStep:
  1. Parse approverId from session_variables
  2. Fetch step_run → get org_id from workflow_run
  3. getUserOrgRole(approverId, orgId) → must be in requiredApproverRoles
  4. Mark step succeeded, resume workflow
```

Layer 2 is necessary for approval gates because:
- The required roles are configurable per gate (stored in `step.config`)
- The approval happens during execution, not at the start
- It triggers workflow resumption — a side effect no DB permission can express

These two layers are independent: bypassing one (e.g. calling the function directly) still hits the other.

---

## Approval Gate Pause/Resume Flow

1. `executeWorkflow()` iterates steps in order. When it reaches an `approval_gate` step:
   - Inserts a `step_run` with `status = awaiting_approval`
   - Updates `workflow_runs.status = paused`, sets `paused_at_step_id`
   - Returns immediately — the Hasura subscription pushes the paused state to every connected client

2. The run detail page (`/dashboard/runs/[runId]`) shows an "Awaiting Your Approval" banner for users with `owner` or `editor` role. Viewers see a "waiting for approval" notice but no button.

3. Owner/editor clicks **Approve → Continue**. This calls the `approveStep` Hasura Action:
   - Handler re-verifies approver's role against the workflow's org (**Layer 2 check**)
   - Marks the step as `succeeded` with `approved_by`, `approved_at`, `approval_comment`
   - Responds 200 to the client immediately (so the UI updates)
   - Calls `continueWorkflowFromStep()` asynchronously

4. `continueWorkflowFromStep()` fetches the **full workflow step list** (not just already-run step_runs), finds the approval gate by ID, and executes all steps after it. Each step update fires through the subscription.

5. When all steps complete, `workflow_runs.status = completed` and quota is incremented.

---

## What's Implemented

### Step Types
| Type | Real execution | Owner only? |
|------|---------------|-------------|
| `llm_call` | Groq API (llama-3.3-70b, mixtral, gemma2); stubs with disclosed delay if no key | No |
| `http_request` | Real fetch with 2-retry backoff | No |
| `conditional_branch` | Safe expression evaluator (no `eval`; only `input`/`output` identifiers) | No |
| `approval_gate` | Pauses run; Layer 2 role check on resume | No |
| `db_write` | Writes to `notifications` table | **Yes** |
| `notify` | DB log + optional Slack webhook | **Yes** |

### Trigger Types
| Type | Mechanism |
|------|-----------|
| `manual` | Run button in UI → `triggerWorkflowRun` Action |
| `webhook` | POST `/webhookIngest` with trigger ID + secret |
| `scheduled` | Hasura cron every minute → `scheduledRunner` evaluates cron expressions |
| `database_event` | Hasura Event Trigger → `eventTriggerHandler` fans out to matching workflows |

### Frontend Pages
- `/login` — sign up / sign in (nhost auth)
- `/dashboard` — overview: stats, quota bar, trigger breakdown, live notifications
- `/dashboard/workflows` — searchable list with run/edit/delete per role
- `/dashboard/workflows/[id]` — drag-and-drop step builder, all config panels, trigger config with webhook secret display
- `/dashboard/runs` — full run history (all runs, not just the latest per workflow)
- `/dashboard/runs/[runId]` — live dual-subscription monitor; approval gate UI with comment; expandable I/O JSON per step
- `/dashboard/admin` — team management, role changes, invite by email, create org
- `/dashboard/notifications` — live WebSocket subscription feed

---

## API Keys

- **Groq**: Free at [console.groq.com](https://console.groq.com) — llama-3.3-70b-versatile
- **nhost**: Free tier at [app.nhost.run](https://app.nhost.run)
- **Vercel**: Free hobby plan

If no Groq key is set, `llm_call` steps stub with a 1.5s artificial delay and disclose this in the step output.
