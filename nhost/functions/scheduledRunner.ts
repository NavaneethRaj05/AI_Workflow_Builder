/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import type { Request, Response } from 'express';
import { adminClient } from './shared/graphqlClient';
import { executeWorkflow } from './shared/workflowEngine';
import { gql } from 'graphql-request';
function parseCron(expr: string, options: any) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const cronParser = require('cron-parser');
  const parser = cronParser.parseExpression || cronParser.default?.parseExpression;
  if (typeof parser !== 'function') {
    throw new Error('cron-parser.parseExpression is not a function');
  }
  return parser(expr, options);
}

/**
 * Scheduled Runner
 *
 * Called by Hasura Cron Trigger every minute.
 * Finds all active scheduled workflow triggers whose cron expression
 * matches the current minute, then fires workflow runs for each.
 */
export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  // Verify it's coming from Hasura
  const secret = req.headers['x-hasura-action-secret'];
  if (process.env.NHOST_WEBHOOK_SECRET && secret !== process.env.NHOST_WEBHOOK_SECRET) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const now = new Date();
    // Round to current minute
    const currentMinute = new Date(Math.floor(now.getTime() / 60000) * 60000);

    // Fetch all active scheduled triggers
    const triggersData: any = await adminClient.request(gql`
      query GetScheduledTriggers {
        workflow_triggers(where: {
          trigger_type: { _eq: scheduled }
          is_active: { _eq: true }
          workflow: { is_active: { _eq: true } }
        }) {
          id
          config
          workflow {
            id
            org_id
            name
            is_active
          }
        }
      }
    `);

    const triggers = triggersData?.workflow_triggers || [];
    console.log(`[ScheduledRunner] Checking ${triggers.length} scheduled triggers at ${currentMinute.toISOString()}`);

    const firedRuns: string[] = [];

    for (const trigger of triggers) {
      const cronExpr = trigger.config?.cron_expression;
      if (!cronExpr) continue;

      try {
        // Check if cron matches current minute
        const interval = parseCron(cronExpr, {
          currentDate: new Date(currentMinute.getTime() - 1000),
          utc: true,
        });

        const nextFire = interval.next().toDate();
        const diffMs = Math.abs(nextFire.getTime() - currentMinute.getTime());

        // Fire if within 30 seconds of the scheduled time
        if (diffMs <= 30000) {
          const runData: any = await adminClient.request(gql`
            mutation CreateScheduledRun($object: workflow_runs_insert_input!) {
              insert_workflow_runs_one(object: $object) { id }
            }
          `, {
            object: {
              workflow_id: trigger.workflow.id,
              org_id: trigger.workflow.org_id,
              triggered_by: null,
              trigger_type: 'scheduled',
              status: 'pending',
              input: { scheduled_at: currentMinute.toISOString() },
            },
          });

          const runId = runData?.insert_workflow_runs_one?.id;
          firedRuns.push(runId);

          console.log(`[ScheduledRunner] Firing workflow "${trigger.workflow.name}" (${trigger.workflow.id}), run ${runId}`);

          executeWorkflow(
            trigger.workflow.id,
            runId,
            trigger.workflow.org_id,
            null,
            { scheduled_at: currentMinute.toISOString(), trigger_id: trigger.id }
          ).catch(err => {
            console.error(`[ScheduledRunner] Run ${runId} failed:`, err);
          });
        }
      } catch (cronError: any) {
        console.error(`[ScheduledRunner] Invalid cron expression for trigger ${trigger.id}: ${cronExpr}`, cronError.message);
      }
    }

    return res.status(200).json({
      checked_triggers: triggers.length,
      fired_runs: firedRuns.length,
      run_ids: firedRuns,
      timestamp: currentMinute.toISOString(),
    });

  } catch (error: any) {
    console.error('[ScheduledRunner] Error:', error);
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
}
