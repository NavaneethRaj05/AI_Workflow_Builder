import type { Request, Response } from 'express';
import { adminClient, getUserOrgRole } from './shared/graphqlClient';
import { continueWorkflowFromStep } from './shared/workflowEngine';
import { gql } from 'graphql-request';

/**
 * Hasura Action: approveStep
 *
 * This handler implements Layer 2 permission gating for approval_gate steps.
 * The approval decision is a runtime check that CANNOT be a DB permission:
 * - It requires knowing which org the approver is in (mid-execution context)
 * - It requires verifying the approver's role matches what the step expects
 * - After approval, it resumes the paused workflow from the next step
 *
 * This is explicitly NOT enforced by database permissions alone.
 */
export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { input, session_variables } = req.body;
    const { step_run_id, comment } = input;

    const approverId: string = session_variables?.['x-hasura-user-id'];
    if (!approverId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    // Fetch step_run with full context
    const stepRunData: any = await adminClient.request(gql`
      query GetStepRunForApproval($id: uuid!) {
        step_runs_by_pk(id: $id) {
          id
          status
          workflow_run_id
          workflow_step {
            id
            step_type
            config
          }
          workflow_run {
            id
            org_id
            workflow_id
            status
            paused_at_step_id
            workflow {
              id
              org_id
            }
          }
        }
      }
    `, { id: step_run_id });

    const stepRun = stepRunData?.step_runs_by_pk;
    if (!stepRun) {
      return res.status(404).json({ message: 'Step run not found' });
    }

    // Verify this step is actually an approval_gate in awaiting_approval state
    if (stepRun.workflow_step?.step_type !== 'approval_gate') {
      return res.status(400).json({ message: 'This step is not an approval gate' });
    }

    if (stepRun.status !== 'awaiting_approval') {
      return res.status(400).json({
        message: `Step is not awaiting approval (current status: ${stepRun.status})`,
      });
    }

    const orgId = stepRun.workflow_run?.org_id;
    const workflowRunStatus = stepRun.workflow_run?.status;

    if (workflowRunStatus !== 'paused') {
      return res.status(400).json({
        message: `Workflow run is not paused (status: ${workflowRunStatus})`,
      });
    }

    // =========================================================
    // LAYER 2: Verify approver's role in the SPECIFIC org
    // This check happens here (in code) because:
    // 1. It's a runtime decision during workflow execution
    // 2. The role check must match the workflow's org, not any org
    // 3. Database permissions can't capture this mid-run context
    // =========================================================
    const approverRole = await getUserOrgRole(approverId, orgId);

    if (!approverRole) {
      return res.status(403).json({
        message: 'Forbidden: You are not a member of this organization',
      });
    }

    // Check if the step config specifies required approval roles
    const stepConfig = stepRun.workflow_step?.config || {};
    const requiredRoles: string[] = stepConfig.required_approver_roles || ['owner', 'editor'];

    if (!requiredRoles.includes(approverRole)) {
      return res.status(403).json({
        message: `Forbidden: Your role '${approverRole}' is not authorized to approve this step. Required roles: ${requiredRoles.join(', ')}`,
      });
    }

    // =========================================================
    // UPDATE STEP RUN: Mark as approved
    // =========================================================
    await adminClient.request(gql`
      mutation ApproveStepRun($id: uuid!, $approver_id: uuid!, $comment: String) {
        update_step_runs_by_pk(
          pk_columns: {id: $id}
          _set: {
            status: succeeded
            approved_by: $approver_id
            approved_at: "now()"
            approval_comment: $comment
            completed_at: "now()"
            output: {approved: true, approved_by: $approver_id}
          }
        ) { id }
      }
    `, {
      id: step_run_id,
      approver_id: approverId,
      comment: comment || null,
    });

    // =========================================================
    // RESUME WORKFLOW from next step
    // =========================================================
    const pausedAtStepId = stepRun.workflow_run?.paused_at_step_id || stepRun.workflow_step?.id;
    const runId = stepRun.workflow_run_id;

    // Respond to client first
    res.status(200).json({
      success: true,
      message: 'Step approved. Resuming workflow execution...',
    });

    // Continue execution asynchronously
    continueWorkflowFromStep(
      runId,
      pausedAtStepId,
      { approved: true, approved_by: approverId, comment }
    ).catch(error => {
      console.error(`[approveStep] Resume error for run ${runId}:`, error);
    });

  } catch (error: any) {
    console.error('[approveStep] Error:', error);
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
}
