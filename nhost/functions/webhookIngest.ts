/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import type { Request, Response } from 'express';
import { adminClient } from './shared/graphqlClient';
import { executeWorkflow } from './shared/workflowEngine';
import { gql } from 'graphql-request';
import crypto from 'crypto';

/**
 * Hasura Action: webhookIngest
 *
 * External systems call this endpoint to trigger a workflow run via webhook.
 * The webhook URL looks like: POST /api/webhookIngest
 * With payload: { trigger_id: string, secret: string, data: any }
 */
export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { input } = req.body;
    const { trigger_id, secret: providedSecret, data: webhookData } = input || req.body;

    if (!trigger_id) {
      return res.status(400).json({ message: 'trigger_id is required' });
    }

    // Fetch the webhook trigger
    const triggerData: any = await adminClient.request(gql`
      query GetWebhookTrigger($id: uuid!) {
        workflow_triggers_by_pk(id: $id) {
          id
          trigger_type
          webhook_secret
          is_active
          config
          workflow {
            id
            org_id
            is_active
            name
          }
        }
      }
    `, { id: trigger_id });

    const trigger = triggerData?.workflow_triggers_by_pk;

    if (!trigger) {
      return res.status(404).json({ message: 'Trigger not found' });
    }

    if (trigger.trigger_type !== 'webhook') {
      return res.status(400).json({ message: 'This trigger is not a webhook trigger' });
    }

    if (!trigger.is_active) {
      return res.status(400).json({ message: 'This webhook trigger is not active' });
    }

    if (!trigger.workflow?.is_active) {
      return res.status(400).json({ message: 'Associated workflow is not active' });
    }

    // =========================================================
    // Verify webhook secret (timing-safe comparison)
    // =========================================================
    if (trigger.webhook_secret) {
      if (!providedSecret) {
        return res.status(401).json({ message: 'Webhook secret required' });
      }
      const expectedBuffer = Buffer.from(trigger.webhook_secret);
      const providedBuffer = Buffer.from(providedSecret);

      if (
        expectedBuffer.length !== providedBuffer.length ||
        !crypto.timingSafeEqual(expectedBuffer, providedBuffer)
      ) {
        return res.status(401).json({ message: 'Invalid webhook secret' });
      }
    }

    // =========================================================
    // Create workflow run
    // =========================================================
    const runData: any = await adminClient.request(gql`
      mutation CreateWebhookRun($object: workflow_runs_insert_input!) {
        insert_workflow_runs_one(object: $object) { id }
      }
    `, {
      object: {
        workflow_id: trigger.workflow.id,
        org_id: trigger.workflow.org_id,
        triggered_by: null,
        trigger_type: 'webhook',
        trigger_data: webhookData || {},
        status: 'pending',
        input: webhookData || {},
      },
    });

    const runId = runData?.insert_workflow_runs_one?.id;

    // Respond immediately
    res.status(200).json({
      run_id: runId,
      status: 'started',
      message: `Workflow "${trigger.workflow.name}" triggered via webhook`,
    });

    // Execute asynchronously
    executeWorkflow(
      trigger.workflow.id,
      runId,
      trigger.workflow.org_id,
      null,
      webhookData || {}
    ).catch(err => {
      console.error(`[webhookIngest] Execution error for run ${runId}:`, err);
    });

  } catch (error: any) {
    console.error('[webhookIngest] Error:', error);
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
}
