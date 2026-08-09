# FlowForge — AI Agent Workflow Builder

A full-stack mini-n8n for chaining AI agent steps, built with **nhost (Postgres + Hasura + Auth + Functions)** and **Next.js**.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                Next.js (Vercel)                      │
│  Auth · Workflow Builder · Run Monitor · Quota       │
└─────────────────┬───────────────────────────────────┘
                  │ GraphQL (queries/mutations/subs)
┌─────────────────▼───────────────────────────────────┐
│           Hasura GraphQL Engine (nhost)              │
│  Row-level permissions · Actions · Event Triggers   │
│  Subscriptions · Computed Fields                     │
└────────┬───────────────────────┬────────────────────┘
         │                       │
┌────────▼────────┐    ┌─────────▼──────────────────────┐
│  PostgreSQL     │    │   nhost Serverless Functions   │
│  (nhost DB)     │    │   triggerWorkflowRun           │
└─────────────────┘    │   approveStep                  │
                       │   webhookIngest                │
                       │   scheduledRunner              │
                       │   eventTriggerHandler          │
                       └────────────────────────────────┘
```

---

## Quick Start (Local)

### Prerequisites

- Node.js 18+
- Docker Desktop
- nhost CLI: `npm install -g @nhost/cli`

### Setup

```bash
git clone <your-repo>
cd ai-workflow-builder
npm install --legacy-peer-deps
```

### Configure Environment

```bash
cp .env.local .env.local.example  # already exists as template
```

Fill in `.env.local`:

```env
NEXT_PUBLIC_NHOST_SUBDOMAIN=your-project-subdomain
NEXT_PUBLIC_NHOST_REGION=eu-central-1
NHOST_ADMIN_SECRET=your-admin-secret
NHOST_WEBHOOK_SECRET=any-random-secret
GROQ_API_KEY=your-groq-api-key
SLACK_WEBHOOK_URL=                    # Optional
```

### Start Local Backend

```bash
nhost up --config nhost/nhost.toml
```

Apply migrations and metadata:
```bash
nhost dev hasura migrate apply --database-name default
nhost dev hasura metadata apply
```

### Start Frontend

```bash
npm run dev
```

Open http://localhost:3000

---

## Deployment

### Backend (nhost Cloud)

1. Create project at app.nhost.run
2. Connect GitHub repo (auto-deploys from `nhost/` directory)
3. Add secrets: `GROQ_API_KEY`, `NHOST_WEBHOOK_SECRET`

### Frontend (Vercel)

1. Connect repo to Vercel
2. Set env vars: `NEXT_PUBLIC_NHOST_SUBDOMAIN`, `NEXT_PUBLIC_NHOST_REGION`
3. Deploy

---

## Database Schema

| Table | Description |
|-------|-------------|
| `organizations` | Orgs with quota (limit + used per month) |
| `org_members` | User+org join with role (owner/editor/viewer) |
| `workflows` | Belong to an org |
| `workflow_steps` | Ordered steps with type + JSONB config |
| `workflow_triggers` | manual/webhook/scheduled/database_event |
| `workflow_runs` | Each execution, status incl. `paused` |
| `step_runs` | Per-step: status/input/output/error/approval |
| `notifications` | Log for notify step type |

---

## Permission Layers

### Layer 1: Hasura Row-Level Security

Every table permission scopes to the caller's org via org_members subquery. Direct UUID guessing returns empty.

### Layer 2: Action Handler Role Checks

`approveStep` explicitly fetches the approver's role at runtime:

```typescript
const approverRole = await getUserOrgRole(approverId, orgId);
if (!requiredRoles.includes(approverRole)) {
  return res.status(403).json({ message: 'Insufficient role' });
}
```

---

## Step Types

| Type | Owner Only? |
|------|-------------|
| `llm_call` (Groq) | No |
| `http_request` | No |
| `db_write` | Yes |
| `notify` (Slack/DB) | Yes |
| `conditional_branch` | No |
| `approval_gate` | No |

---

## Trigger Types

| Type | Mechanism |
|------|-----------|
| `manual` | UI Run button |
| `webhook` | POST to `/api/webhookIngest` |
| `scheduled` | Hasura cron every minute |
| `database_event` | Hasura Event Trigger |

### Webhook Usage

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
