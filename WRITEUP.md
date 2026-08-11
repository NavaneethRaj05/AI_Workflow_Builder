# FlowForge — Design Write-Up

## Schema Reasoning

The schema uses eight tables organised around a clear ownership chain:
`organizations → org_members → workflows → workflow_steps / workflow_triggers → workflow_runs → step_runs`.

**Key decisions:**

- `JSONB` for `workflow_steps.config` — each step type (llm_call, http_request, conditional_branch, etc.) has its own config shape. JSONB avoids a new migration every time a field is added to a step type, while still being queryable.
- `workflow_runs.duration_ms` is a `GENERATED ALWAYS AS` computed column, not application code — the DB always tracks it correctly even for runs that fail or are manually cancelled.
- `total_steps` and `completed_steps` on `workflow_runs` are Hasura computed fields backed by SQL functions (`workflow_run_step_count`, `workflow_run_completed_steps`). The live subscription payload includes these without a join, so the progress bar updates in real time.
- `quota_remaining` on `organizations` is a computed field (`get_org_quota_remaining()`), exposing remaining budget as a first-class GraphQL field.
- `check_and_increment_quota()` uses `SELECT ... FOR UPDATE` to prevent double-spending quota under concurrent runs.
- `workflow_runs.paused_at_step_id` stores which step paused the run, enabling the resume path in `continueWorkflowFromStep()` to find the exact position without scanning all step_runs.
- `step_runs.approved_by / approved_at / approval_comment` provide a full audit trail for every approval gate decision.

---

## Two Permission Layers

### Layer 1 — Hasura Row-Level Security (declarative, always enforced)

Every table that touches org data has a Hasura permission `filter` that traverses the relationship chain back to `org_members`:

```yaml
filter:
  workflow:
    organization:
      org_members:
        user_id: { _eq: X-Hasura-User-Id }
```

This is enforced at the Postgres query level — it cannot be bypassed by the application. An Org B user who guesses a valid Org A UUID gets **zero rows**, not a 403. They cannot even confirm the resource exists.

Role differentiation is also expressed declaratively:
- `workflow_steps` insert/update/delete permissions use an `_or` filter: `owner` may use any `step_type`; `editor` is restricted to `llm_call`, `http_request`, `conditional_branch`, `approval_gate`. Editors literally cannot save a `db_write` or `notify` step — Hasura's check constraint rejects it at the database level.
- `workflow_triggers` applies the same pattern: editors cannot create `webhook` or `database_event` triggers.
- Viewers have no insert or update permissions on any table.

### Layer 2 — Action Handler Code (imperative, for runtime decisions)

`triggerWorkflowRun` and `approveStep` are Hasura Actions backed by serverless functions. Both re-verify org membership and role in application code after Hasura forwards the request:

**triggerWorkflowRun:**
1. Extracts caller user ID from `session_variables` forwarded by Hasura
2. Fetches the workflow to get its `org_id`
3. Calls `getUserOrgRole(callerId, workflow.org_id)` — must return `owner` or `editor`
4. Checks quota (`quota_used < quota_limit`)
5. Creates the run and executes

**approveStep:**
1. Extracts approver ID from `session_variables`
2. Fetches the `step_run` to get the workflow's `org_id`
3. Calls `getUserOrgRole(approverId, orgId)` — must be in `step.config.required_approver_roles` (defaults to `['owner', 'editor']`)
4. Marks step succeeded, then resumes the workflow

Layer 2 is necessary for approval gates because the required roles are configurable per gate (stored in `step.config`), and the decision happens mid-execution — a side effect (workflow resumption) that no database permission can express.

The two layers are independent. Bypassing Layer 1 (calling the function directly with a forged JWT) still hits Layer 2's explicit role lookup. Bypassing Layer 2 (a direct Hasura mutation) still hits Layer 1's row-level filters.

---

## Approval Gate Pause / Resume

1. `executeWorkflow()` iterates steps in order. On reaching an `approval_gate` step:
   - Inserts a `step_run` with `status = awaiting_approval`
   - Updates `workflow_runs.status = paused`, writes `paused_at_step_id`
   - Returns immediately — the Hasura WebSocket subscription pushes the paused state to every connected client without any polling

2. The run detail page shows an **Approve → Continue** button to users with `owner` or `editor` role. Viewers see a notice but no action.

3. On approval, the `approveStep` Action handler:
   - Re-verifies the approver's role (Layer 2 check)
   - Marks the step as `succeeded` with `approved_by`, `approved_at`, `approval_comment`
   - Responds 200 to the client immediately (so the UI updates)
   - Calls `continueWorkflowFromStep()` asynchronously

4. `continueWorkflowFromStep()` fetches the **full `workflow_steps` list** (not `step_runs`, which only contains already-executed steps), finds the approval gate by `paused_at_step_id`, and executes all steps after it. Each status change fires through the subscription.

5. On completion, `workflow_runs.status = completed` and `quota_used` is incremented.
