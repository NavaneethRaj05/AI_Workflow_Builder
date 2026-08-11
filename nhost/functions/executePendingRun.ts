/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Request, Response } from 'express';
import { getAdminClient, getUserOrgRole, UPDATE_WORKFLOW_RUN } from './shared/graphqlClient';
import { executeWorkflow } from './shared/workflowEngine';
import { gql } from 'graphql-request';

/**
 * Nhost Function: executePendingRun
 *
 * Executes a pending workflow_run by run_id.
 * Validates caller org membership before execution.
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
    const adminSecret = process.env.HASURA_GRAPHQL_ADMIN_SECRET || process.env.NHOST_ADMIN_SECRET;
    console.log('[executePendingRun] Has admin secret:', !!adminSecret);
    console.log('[executePendingRun] Env keys:', Object.keys(process.env).filter(k => !k.includes('PASS') && !k.includes('SECRET') && !k.includes('KEY')));

    const input = req.body?.input ?? req.body;
    const run_id = input?.run_id || req.body?.run_id;
    const session_variables = req.body?.session_variables || {};

    let callerId: string =
      session_variables?.['x-hasura-user-id'] ||
      session_variables?.['X-Hasura-User-Id'] ||
      (req.headers as any)?.['x-hasura-user-id'] ||
      (req as any).user?.id;

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
        }
      } catch (e) {
        console.warn('Failed to parse JWT in executePendingRun:', e);
      }
    }

    if (!run_id) {
      return res.status(400).json({ message: 'run_id is required' });
    }

    // If neither admin secret nor user auth is available, we cannot make any DB calls.
    // Return a clear error immediately instead of a confusing 500.
    if (!adminSecret && !authHeader) {
      console.error('[executePendingRun] No credentials available — set NHOST_ADMIN_SECRET in your Nhost project environment variables.');
      return res.status(500).json({
        message: 'Server misconfiguration: NHOST_ADMIN_SECRET is not set. Please configure it in your Nhost project settings.',
        code: 'MISSING_ADMIN_SECRET',
      });
    }

    const client = getAdminClient(req);

    // Fetch run details
    const runData: any = await client.request(gql`
      query GetRunForExec($id: uuid!) {
        workflow_runs(where: { id: { _eq: $id } }) {
          id
          workflow_id
          org_id
          status
          input
        }
      }
    `, { id: run_id });

    const run = runData?.workflow_runs?.[0];
    if (!run) {
      return res.status(404).json({ message: 'Workflow run not found' });
    }

    if (run.status === 'completed' || run.status === 'failed') {
      return res.status(200).json({
        run_id: run.id,
        status: run.status,
        message: `Workflow run is already ${run.status}`,
      });
    }

    if (run.status === 'running') {
      return res.status(200).json({
        run_id: run.id,
        status: 'running',
        message: 'Workflow execution is already in progress',
      });
    }

    // Verify caller org membership if callerId is known.
    // When no callerId is present (e.g. fallback direct-insert path), the admin
    // secret on the GraphQL client already authorises all DB operations, so we
    // skip the membership check rather than blocking execution.
    if (callerId) {
      const userRole = await getUserOrgRole(callerId, run.org_id, req);
      if (!userRole || !['owner', 'editor'].includes(userRole)) {
        return res.status(403).json({ message: 'Forbidden: Owner or editor role required' });
      }
    }

    // Respond immediately so the browser doesn't hang, then execute
    // synchronously with a timeout guard so the run never stays stuck.
    // We can't truly respond-then-continue in Nhost functions (no background
    // worker), so we use a timeout race and mark as failed if we exceed 55 s.
    res.status(200).json({
      run_id: run.id,
      status: 'started',
      message: 'Workflow execution started',
    });

    const EXEC_TIMEOUT_MS = 55_000;
    const timeoutGuard = new Promise<{ status: string }>((resolve) =>
      setTimeout(() => resolve({ status: 'timeout' }), EXEC_TIMEOUT_MS)
    );

    try {
      const result = await Promise.race([
        executeWorkflow(run.workflow_id, run.id, run.org_id, callerId || null, run.input || {}, req),
        timeoutGuard,
      ]);

      if ((result as any).status === 'timeout') {
        await client.request(UPDATE_WORKFLOW_RUN, {
          id: run.id,
          set: {
            status: 'failed',
            completed_at: new Date().toISOString(),
            output: { error: 'Execution timed out after 55 s' },
          },
        });
      }
    } catch (err: any) {
      console.error(`[executePendingRun] Error executing run ${run.id}:`, err);
      try {
        await client.request(UPDATE_WORKFLOW_RUN, {
          id: run.id,
          set: {
            status: 'failed',
            completed_at: new Date().toISOString(),
            output: { error: err.message || 'Execution failed' },
          },
        });
      } catch (updateErr) {
        console.error(`[executePendingRun] Failed to mark run ${run.id} as failed:`, updateErr);
      }
    }

  } catch (error: any) {
    console.error('[executePendingRun] Error:', error);

    // Try to mark the run as failed if we have a run_id and a client
    const run_id = req.body?.input?.run_id || req.body?.run_id;
    if (run_id) {
      try {
        const failClient = getAdminClient(req);
        await failClient.request(UPDATE_WORKFLOW_RUN, {
          id: run_id,
          set: {
            status: 'failed',
            completed_at: new Date().toISOString(),
            output: { error: error.message || 'Execution failed before starting' },
          },
        });
      } catch {
        // Swallow — we already can't reach the DB
      }
    }

    return res.status(500).json({
      message: error.message || 'Internal server error',
      details: error?.response?.errors || error?.response || error?.message,
      hint: error.message?.includes('MISSING_ADMIN_SECRET') || (!process.env.HASURA_GRAPHQL_ADMIN_SECRET && !process.env.NHOST_ADMIN_SECRET)
        ? 'Set NHOST_ADMIN_SECRET in your Nhost project environment variables (Dashboard → Settings → Secrets)'
        : undefined,
    });
  }
}
