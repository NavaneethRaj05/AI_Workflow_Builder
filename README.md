# FlowForge — AI Agent Workflow Builder

> **Live App**: [your-vercel-url.vercel.app](https://your-vercel-url.vercel.app)  
> **GitHub**: [github.com/yourusername/ai-workflow-builder](https://github.com/yourusername/ai-workflow-builder)

A mini-[n8n](https://n8n.io), purpose-built for chaining AI agent steps. Users inside an organization build multi-step workflows, trigger them multiple ways, and every action is checked against two independent permission layers.

Built with **nhost** (PostgreSQL + Hasura + Auth + Functions) and **Next.js**.

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
                        │  scheduledRunner                │
                        │  eventTriggerHandler            │
                        └────────────────────────────────┘
```

---

## What's Implemented

### ✅ Data Model (8 tables)
| Table | Purpose |
|-------|---------|
| `organizations` | Multi-tenant boundary with monthly quota |
| `org_members` | role-per-user-per-org (owner / editor / viewer) |
| `workflows` | belong to an org |
| `workflow_steps` | ordered steps with JSONB config, 6 types |
| `workflow_triggers` | 4 trigger types wired to Hasura |
| `workflow_runs` | execution records with `paused` state support |
| `step_runs` | per-step execution: status, I/O, approval metadata |
| `notifications` | audit log for `notify` and `db_write` steps |

### ✅ Step Types
| Type | Description | Owner Only? |
|------|-------------|-------------|
| `llm_call` | Real Groq API (llama-3.3-70b, mixtral, etc.) | No |
| `http_request` | Generic REST call with retry | No |
| `conditional_branch` | JS expression evaluated against previous output | No |
| `approval_gate` | Pauses run until an authorized user approves | No |
| `db_write` | Writes result into `notifications` table | **Yes** |
| `notify` | Logs to DB + optional Slack webhook | **Yes** |

### ✅ Trigger Types
| Type | Mechanism |
|------|-----------|
| `manual` | Run button in UI |
| `webhook` | POST to `/webhookIngest` Action with trigger ID + secret |
| `scheduled` | Hasura cron trigger (every minute, evaluates cron expressions) |
| `database_event` | Hasura Event Trigger fires on `notifications` INSERT |

### ✅ Permission Layers
**Layer 1 — Hasura RLS (declarative):**  
Every table has `filter` clauses that include a subquery against `org_members`. Direct UUID guessing by a cross-org user returns zero rows — not an error.

**Layer 2 — Action Handler (imperative):**  
`triggerWorkflowRun` and `approveStep` re-verify org membership and role in code before taking any action. The approval gate check cannot be a DB permission because the required role may vary per gate and the approval triggers workflow resumption.

### ✅ GraphQL Operations
- `GET_ORG_WORKFLOWS` — org's workflows with steps, triggers, most recent run
- `UPSERT_WORKFLOW` — create/edit workflow, steps, and trigger
- `TRIGGER_WORKFLOW_RUN` — Hasura Action (owner/editor only)
- `APPROVE_STEP` — Hasura Action with Layer 2 role check in handler
- `SUBSCRIBE_STEP_RUNS` — live per-step progress (filtered by run ID)
- `SUBSCRIBE_WORKFLOW_RUN` — live run status including `paused` state

### ✅ Frontend Pages
- `/login` — sign up / sign in with nhost auth
- `/dashboard` — overview: stats, quota bar, recent runs
- `/dashboard/workflows` — list with search, step badges, run button
- `/dashboard/workflows/[id]` — drag-and-drop builder with step config panels
- `/dashboard/runs` — run history with status filters
- `/dashboard/runs/[runId]` — live run monitor (subscription) + approval UI
- `/dashboard/admin` — team management, role changes, org creation
- `/dashboard/notifications` — live notification feed (subscription)

---

## Approval Gate — Pause/Resume Flow

1. Workflow engine hits `approval_gate` step
2. Sets `step_runs.status = awaiting_approval`, `workflow_runs.status = paused`, stores `paused_at_step_id`
3. Returns immediately — GraphQL subscription pushes paused state to UI
4. Owner/editor calls `approveStep` mutation
5. Handler re-verifies approver's role against the workflow's org (**Layer 2**)
6. Marks step as `succeeded`, calls `continueWorkflowFromStep()`
7. Remaining steps execute; subscription pushes each status change live

---

## Setup & Running Locally

### Prerequisites
- Node.js 18+
- nhost CLI: `npm install -g @nhost/cli`
- Docker Desktop

### 1. Clone & Install

```bash
git clone https://github.com/yourusername/ai-workflow-builder
cd ai-workflow-builder
npm install --legacy-peer-deps
```

### 2. Configure Environment

```bash
cp .env.local.example .env.local
```

Fill in `.env.local`:
```env
NEXT_PUBLIC_NHOST_SUBDOMAIN=your-project-subdomain
NEXT_PUBLIC_NHOST_REGION=eu-central-1
NHOST_ADMIN_SECRET=your-admin-secret
NHOST_WEBHOOK_SECRET=any-random-32-char-string
GROQ_API_KEY=gsk_your-groq-key  # free at console.groq.com
```

### 3. Start Local nhost Backend

```bash
nhost up
```

Apply migrations and metadata:
```bash
nhost hasura migrate apply --database-name default
nhost hasura metadata apply
```

### 4. Start Frontend

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Deploying to Production

### Backend (nhost Cloud)

1. Create project at [app.nhost.run](https://app.nhost.run)
2. Connect GitHub repo — nhost auto-deploys `nhost/` directory
3. Add secrets in nhost dashboard: `GROQ_API_KEY`, `NHOST_ADMIN_SECRET`, `NHOST_WEBHOOK_SECRET`
4. Migrations and metadata apply automatically

### Frontend (Vercel)

1. Connect repo to [vercel.com](https://vercel.com)
2. Set environment variables:
   - `NEXT_PUBLIC_NHOST_SUBDOMAIN`
   - `NEXT_PUBLIC_NHOST_REGION`
3. Deploy

---


```bash
curl -X POST https://your-nhost.nhost.run/v1/webhookIngest \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "trigger_id": "your-trigger-uuid",
      "secret": "your-webhook-secret",
      "data": {"event": "new_order"}
    }
  }'
```

---

## API Keys

- **Groq**: Free at console.groq.com — supports llama-3.3-70b-versatile
- **nhost**: Free tier at app.nhost.run
- **Vercel**: Free hobby plan

If no Groq key is provided, the `llm_call` step stubs with a 2-second delay and discloses this in the output.
