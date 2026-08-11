/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import type { Request, Response } from 'express';
import { adminClient, getUserOrgRole } from './shared/graphqlClient';
import { executeWorkflow } from './shared/workflowEngine';
import { gql } from 'graphql-request';

/**
 * Hasura Action: triggerWorkflowRun
 *
 * This is the main entry point for starting a workflow run.
 *
 * Permission enforcement:
 * - Layer 1 (Hasura): Only owner/editor roles can invoke this action
 * - Layer 1+ (code): Verifies the caller's org membership matches the workflow's org
 * - Layer 2 (code): Checks quota before starting
 */
export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const input = req.body.input || req.body;
    const workflow_id = input?.workflow_id || req.body?.workflow_id;
    const session_variables = req.body.session_variables || {};

    // Extract caller's user ID from Hasura session variables or auth header
    const callerId: string = session_variables?.['x-hasura-user-id'] || (req as any).user?.id;
    const callerRole: string = session_variables?.['x-hasura-role'] || 'user';

    if (!callerId) {
      return res.status(401).json({ message: 'Unauthorized: No user ID in session' });
    }

    if (!workflow_id) {
      return res.status(400).json({ message: 'Bad request: workflow_id is required' });
    }

    // Fetch workflow to get org_id
    const workflowData: any = await adminClient.request(gql`
      query GetWorkflowOrg($id: uuid!) {
        workflows_by_pk(id: $id) {
          id
          org_id
          is_active
          name
        }
      }
    `, { id: workflow_id });

    const workflow = workflowData?.workflows_by_pk;
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    if (!workflow.is_active) {
      return res.status(400).json({ message: 'Workflow is not active' });
    }

    // =========================================================
    // LAYER 1: Verify caller is member of the workflow's org
    // This prevents cross-org attacks even if someone guesses an ID
    // =========================================================
    const userRole = await getUserOrgRole(callerId, workflow.org_id);
    if (!userRole) {
      return res.status(403).json({ message: 'Forbidden: You are not a member of this organization' });
    }

    if (!['owner', 'editor'].includes(userRole)) {
      return res.status(403).json({ message: 'Forbidden: Viewers cannot trigger workflow runs' });
    }

    // =========================================================
    // QUOTA CHECK: Verify org hasn't exhausted its quota
    // =========================================================
    const orgData: any = await adminClient.request(gql`
      query GetOrgQuota($id: uuid!) {
        organizations_by_pk(id: $id) {
          quota_limit
          quota_used
          quota_reset_at
        }
      }
    `, { id: workflow.org_id });

    const org = orgData?.organizations_by_pk;
    const now = new Date();
    const resetAt = new Date(org.quota_reset_at);

    // Auto-reset quota if past reset date
    let quotaUsed = org.quota_used;
    if (now >= resetAt) {
      await adminClient.request(gql`
        mutation ResetQuota($id: uuid!) {
          update_organizations_by_pk(
            pk_columns: {id: $id}
            _set: {
              quota_used: 0,
              quota_reset_at: "${new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString()}"
            }
          ) { id }
        }
      `, { id: workflow.org_id });
      quotaUsed = 0;
    }

    if (quotaUsed >= org.quota_limit) {
      return res.status(429).json({
        message: `Quota exhausted: ${quotaUsed}/${org.quota_limit} runs used this month`,
      });
    }

    // =========================================================
    // CREATE WORKFLOW RUN
    // =========================================================
    const runData: any = await adminClient.request(gql`
      mutation CreateRun($object: workflow_runs_insert_input!) {
        insert_workflow_runs_one(object: $object) {
          id
        }
      }
    `, {
      object: {
        workflow_id,
        org_id: workflow.org_id,
        triggered_by: callerId,
        trigger_type: 'manual',
        status: 'pending',
        input: input?.initial_input || {},
      },
    });

    const runId = runData?.insert_workflow_runs_one?.id;

    // =========================================================
    // EXECUTE WORKFLOW (async — respond immediately then execute)
    // Using a fire-and-forget pattern with Promise to avoid timeout
    // =========================================================
    res.status(200).json({
      run_id: runId,
      status: 'started',
      message: `Workflow "${workflow.name}" run started successfully`,
    });

    // Execute asynchronously after responding
    executeWorkflow(
      workflow_id,
      runId,
      workflow.org_id,
      callerId,
      input?.initial_input || {}
    ).catch(error => {
      console.error(`[triggerWorkflowRun] Execution error for run ${runId}:`, error);
    });

  } catch (error: any) {
    console.error('[triggerWorkflowRun] Error:', error);
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
}
