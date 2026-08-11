/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Request, Response } from 'express';
import { getAdminClient, getUserOrgRole } from './shared/graphqlClient';
import { executeWorkflow } from './shared/workflowEngine';
import { gql } from 'graphql-request';

/**
 * Nhost Function: executePendingRun
 *
 * Executes a pending workflow_run by run_id.
 * Validates caller org membership before execution.
 */
export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const input = req.body.input || req.body;
    const run_id = input?.run_id || req.body?.run_id;
    const session_variables = req.body.session_variables || {};

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

    // Verify caller org membership if callerId is known
    if (callerId) {
      const userRole = await getUserOrgRole(callerId, run.org_id);
      if (!userRole || !['owner', 'editor'].includes(userRole)) {
        return res.status(403).json({ message: 'Forbidden: Owner or editor role required' });
      }
    }

    // Respond immediately
    res.status(200).json({
      run_id: run.id,
      status: 'started',
      message: 'Workflow execution started',
    });

    // Execute asynchronously
    executeWorkflow(
      run.workflow_id,
      run.id,
      run.org_id,
      callerId || null,
      run.input || {},
      req
    ).catch(err => {
      console.error(`[executePendingRun] Error executing run ${run.id}:`, err);
    });

  } catch (error: any) {
    console.error('[executePendingRun] Error:', error);
    return res.status(500).json({
      message: error.message || 'Internal server error',
      details: error?.response?.errors || error?.response || error?.message
    });
  }
}
