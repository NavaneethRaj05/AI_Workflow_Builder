# FlowForge — Design Write-up

## Schema Reasoning

### Why these tables?

The schema was designed around three core concerns: **multi-tenancy isolation**, **execution state**, and **auditability**.

**`organizations` + `org_members`** form the tenancy boundary. Rather than storing a role per user globally, role is scoped to an org — the same user can be an owner in Org A and a viewer in Org B. This is the foundation of cross-org isolation.

**`workflows` → `workflow_steps` → `workflow_triggers`** separate structure from execution. Steps are ordered integers (`step_order`) rather than a linked list — simpler to reorder, index, and query. The JSONB `config` field is intentionally polymorphic: each step type interprets it differently, avoiding the N-tables-for-N-types anti-pattern.

**`workflow_runs` → `step_runs`** track execution state. The `paused` status on `workflow_runs` is essential — it's what allows the approval gate to stop execution and resume later without any external orchestrator. The `paused_at_step_id` column records exactly where to resume.

**`step_runs.approved_by` / `approved_at`** are on the step run (not the workflow run) because approval is a step-level action, and you might have multiple approval gates in one workflow.

**`notifications`** doubles as the sink for both the `notify` step type and the `db_write` step type — this keeps things simple while still providing a queryable audit log.

### Computed fields

`quota_remaining` is a PostgreSQL function (`get_org_quota_remaining`) exposed as a Hasura computed field, so it always reads `quota_limit - quota_used` without a separate query. `org_monthly_usage` is a view that aggregates runs for the current calendar month, providing both reporting and quota-reset logic.

---

## Two Permission Layers — How They Differ

### Layer 1: Hasura Row-Level Security (Declarative)

Layer 1 is enforced at the **database query level** by Hasura's permission rules. Every single table has a `filter` clause that includes a subquery against `org_members`:

```yaml
filter:
  org_id:
    _in:
      $select:
        table: org_members
        columns: [org_id]
        where:
          user_id: { _eq: X-Hasura-User-Id }
```

This means:
- A viewer in Org A can read Org A's workflows but not Org B's — even if they know the UUID
- An editor cannot write `db_write` or `notify` steps — blocked at insert permission by checking `step_type _in [allowed_types]`
- Owners can add webhook triggers; editors are restricted to `manual` and `scheduled`

Layer 1 is **declarative and automatic** — it fires on every GraphQL operation without any application code.

### Layer 2: Action Handler Runtime Checks (Imperative)

Layer 2 is enforced in the **serverless function code** and handles decisions that cannot be expressed as static database rules.

The clearest example is `approveStep`:

```typescript
// This cannot be a DB permission because:
// 1. We need to check the approver's role in a specific org (which org? determined at runtime)
// 2. The step config can specify custom required roles per gate
// 3. After approval, the function needs to resume execution — no DB rule can "continue running a workflow"

const approverRole = await getUserOrgRole(approverId, orgId);
const requiredRoles = stepConfig.required_approver_roles || ['owner', 'editor'];

if (!requiredRoles.includes(approverRole)) {
  return res.status(403).json({
    message: `Your role '${approverRole}' cannot approve this step. Required: ${requiredRoles.join(', ')}`
  });
}
```

Similarly, `triggerWorkflowRun` checks:
1. Is the caller a member of the workflow's org? (layer 1 duplicate defense-in-depth)
2. Has the org's quota been exhausted?
3. After each step, is the step type allowed for this org's configuration?

**Why two layers?** Because Layer 1 protects data reads/writes (the storage plane), while Layer 2 protects business logic decisions (the execution plane). An attacker who bypasses Layer 1 still hits Layer 2, and vice versa.

---

## Approval Gate Pause/Resume

The approval gate is implemented without any external job queue or polling:

### Pause

1. Workflow engine hits an `approval_gate` step
2. Engine sets `step_runs.status = 'awaiting_approval'` and `workflow_runs.status = 'paused'`, stores `paused_at_step_id`
3. Engine returns immediately — the function exits
4. The GraphQL subscription on `step_runs` and `workflow_runs` automatically pushes the paused state to all connected clients

### Resume (approveStep Action)

1. An owner/editor calls the `approveStep` GraphQL mutation
2. Hasura validates the role (Layer 1: only owner/editor can invoke this Action)
3. The handler function validates role again against the specific org (Layer 2)
4. Handler updates `step_runs.approved_by`, `approved_at`, `status = succeeded`
5. Handler calls `continueWorkflowFromStep(runId, pausedAtStepId)` — which re-queries the workflow, finds all steps after the approval gate, and executes them
6. Execution resumes from the next step, updating `step_runs` throughout
7. Subscription fires on every status change, so the UI shows the resumed steps appearing in real time

**Key design decision**: The resume is synchronous within the same `approveStep` function call (after responding 200 to the client). This avoids needing a message queue or separate orchestrator while still giving the user immediate feedback. For very long workflows, a production system would use a proper job queue (BullMQ, etc.), but this approach is correct for the scope of this assignment.
