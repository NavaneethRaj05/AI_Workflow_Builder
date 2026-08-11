/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import type { Request, Response } from 'express';
import { adminClient, getUserOrgRole, getAdminClient, UPDATE_WORKFLOW_RUN } from './shared/graphqlClient';
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
  // Set CORS headers for browser requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-hasura-admin-secret, x-hasura-role, x-hasura-user-id');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const input = req.body.input || req.body;
    const workflow_id = input?.workflow_id || req.body?.workflow_id;
    const session_variables = req.body.session_variables || {};

    console.log('[triggerWorkflowRun] Incoming headers:', JSON.stringify(req.headers));
    console.log('[triggerWorkflowRun] Incoming body keys:', Object.keys(req.body || {}));

    // Extract caller's user ID from Hasura session variables, headers, auth header, or req.user
    let callerId: string =
      session_variables?.['x-hasura-user-id'] ||
      session_variables?.['X-Hasura-User-Id'] ||
      (req.headers as any)?.['x-hasura-user-id'] ||
      (req as any).user?.id;

    let callerRole: string =
      session_variables?.['x-hasura-role'] ||
      session_variables?.['X-Hasura-Role'] ||
      (req.headers as any)?.['x-hasura-role'] ||
      'user';

    const authHeader =
      (req.headers.authorization as string) ||
      (req.headers as any)?.Authorization ||
      (req.headers as any)?.['authorization'];

    if (!callerId && authHeader) {
      try {
        const token = authHeader.replace(/^Bearer\s+/i, '').trim();
        const payloadBase64 = token.split('.')[1];
        if (payloadBase64) {
          const decoded = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf-8'));
          const hasuraClaims = decoded['https://hasura.io/jwt/claims'];
          callerId = hasuraClaims?.['x-hasura-user-id'] || decoded.sub;
          callerRole = hasuraClaims?.['x-hasura-default-role'] || 'user';
        }
      } catch (e) {
        console.warn('Failed to parse JWT in function:', e);
      }
    }

    if (!callerId) {
      return res.status(401).json({ message: 'Unauthorized: No user ID in session' });
    }

    if (!workflow_id) {
      return res.status(400).json({ message: 'Bad request: workflow_id is required' });
    }

    const adminSecret = process.env.HASURA_GRAPHQL_ADMIN_SECRET || process.env.NHOST_ADMIN_SECRET;
    if (!adminSecret && !authHeader) {
      console.error('[triggerWorkflowRun] No credentials available — NHOST_ADMIN_SECRET is not set.');
      return res.status(500).json({
        message: 'Server misconfiguration: NHOST_ADMIN_SECRET is not set. Configure it in Nhost Dashboard → Settings → Secrets.',
        code: 'MISSING_ADMIN_SECRET',
      });
    }

    const client = getAdminClient(req);

    // Fetch workflow to get org_id
    const workflowData: any = await client.request(gql`
      query GetWorkflowOrg($id: uuid!) {
        workflows(where: { id: { _eq: $id } }) {
          id
          org_id
          is_active
          name
        }
      }
    `, { id: workflow_id });

    const workflow = workflowData?.workflows?.[0] || workflowData?.workflows_by_pk;
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
    const userRole = await getUserOrgRole(callerId, workflow.org_id, req);
    if (!userRole) {
      return res.status(403).json({ message: 'Forbidden: You are not a member of this organization' });
    }

    if (!['owner', 'editor'].includes(userRole)) {
      return res.status(403).json({ message: 'Forbidden: Viewers cannot trigger workflow runs' });
    }

    // =========================================================
    // QUOTA CHECK: Verify org hasn't exhausted its quota
    // =========================================================
    const orgData: any = await client.request(gql`
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
      await client.request(gql`
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
    const runData: any = await client.request(gql`
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
    // EXECUTE WORKFLOW — run synchronously with a timeout guard
    // so the run never gets stuck in "pending" forever.
    // Nhost functions have ~60 s; we fail-safe at 55 s.
    // =========================================================
    const EXEC_TIMEOUT_MS = 55_000;

    const timeoutGuard = new Promise<{ status: string; run_id: string }>(resolve =>
      setTimeout(() => resolve({ status: 'timeout', run_id: runId }), EXEC_TIMEOUT_MS)
    );

    try {
      const result = await Promise.race([
        executeWorkflow(
          workflow_id,
          runId,
          workflow.org_id,
          callerId,
          input?.initial_input || {},
          req
        ),
        timeoutGuard,
      ]);

      if ((result as any).status === 'timeout') {
        // Mark run as failed so it doesn't stay stuck
        await client.request(UPDATE_WORKFLOW_RUN, {
          id: runId,
          set: {
            status: 'failed',
            completed_at: new Date().toISOString(),
            output: { error: 'Execution timed out after 55 s' },
          },
        });
        return res.status(200).json({
          run_id: runId,
          status: 'failed',
          message: 'Workflow execution timed out',
        });
      }

      return res.status(200).json({
        run_id: runId,
        status: (result as any).status || 'completed',
        message: `Workflow "${workflow.name}" run finished with status: ${(result as any).status}`,
      });
    } catch (execError: any) {
      console.error(`[triggerWorkflowRun] Execution error for run ${runId}:`, execError);
      // Mark run as failed so it doesn't stay stuck in pending/running
      try {
        await client.request(UPDATE_WORKFLOW_RUN, {
          id: runId,
          set: {
            status: 'failed',
            completed_at: new Date().toISOString(),
            error: execError.message || 'Execution failed',
          },
        });
      } catch (e) {
        console.error('[triggerWorkflowRun] Could not mark run as failed:', e);
      }
      return res.status(500).json({
        run_id: runId,
        status: 'failed',
        message: execError.message || 'Workflow execution failed',
      });
    }

  } catch (error: any) {
    console.error('[triggerWorkflowRun] Error:', error);
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
}
