/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import type { Request, Response } from 'express';
import { adminClient } from './shared/graphqlClient';
import { executeWorkflow } from './shared/workflowEngine';
import { gql } from 'graphql-request';

/**
 * Event Trigger Handler
 *
 * Called by Hasura Event Triggers when a watched database table changes.
 * Finds workflows with 'database_event' triggers and fires them.
 *
 * The Hasura Event Trigger is configured on workflow_triggers table inserts
 * OR on any user-configured watched table.
 */
export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  // Verify Hasura Event Trigger request
  const secret = req.headers['x-hasura-action-secret'];
  if (process.env.NHOST_WEBHOOK_SECRET && secret !== process.env.NHOST_WEBHOOK_SECRET) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const eventPayload = req.body;

    // Hasura Event Trigger payload structure
    const {
      event,
      table,
      trigger,
      delivery_info,
    } = eventPayload;

    const tableName = table?.name;
    const schemaName = table?.schema || 'public';
    const operation = event?.op; // INSERT, UPDATE, DELETE, MANUAL
    const newData = event?.data?.new;
    const oldData = event?.data?.old;

    console.log(`[EventTriggerHandler] Event on ${schemaName}.${tableName}, op: ${operation}`);

    // Find all 'database_event' triggers that watch this table
    const triggersData: any = await adminClient.request(gql`
      query GetDatabaseEventTriggers($table_name: String!) {
        workflow_triggers(where: {
          trigger_type: { _eq: database_event }
          is_active: { _eq: true }
          workflow: { is_active: { _eq: true } }
        }) {
          id
          config
          workflow {
            id
            org_id
            name
          }
        }
      }
    `, { table_name: tableName });

    const allTriggers = triggersData?.workflow_triggers || [];

    // Filter triggers that match this table and operation
    const matchingTriggers = allTriggers.filter((t: any) => {
      const config = t.config || {};
      const watchedTable = config.watched_table;
      const watchedOps: string[] = config.operations || ['INSERT', 'UPDATE', 'DELETE'];

      return (
        (!watchedTable || watchedTable === tableName) &&
        watchedOps.includes(operation)
      );
    });

    console.log(`[EventTriggerHandler] Matched ${matchingTriggers.length} workflow triggers`);

    const firedRuns: string[] = [];

    for (const trigger of matchingTriggers) {
      const runData: any = await adminClient.request(gql`
        mutation CreateEventRun($object: workflow_runs_insert_input!) {
          insert_workflow_runs_one(object: $object) { id }
        }
      `, {
        object: {
          workflow_id: trigger.workflow.id,
          org_id: trigger.workflow.org_id,
          triggered_by: null,
          trigger_type: 'database_event',
          trigger_data: {
            table: tableName,
            operation,
            new_data: newData,
            old_data: oldData,
            event_id: delivery_info?.id,
          },
          status: 'pending',
          input: {
            event_table: tableName,
            operation,
            data: newData || oldData,
          },
        },
      });

      const runId = runData?.insert_workflow_runs_one?.id;
      firedRuns.push(runId);

      executeWorkflow(
        trigger.workflow.id,
        runId,
        trigger.workflow.org_id,
        null,
        { event_table: tableName, operation, data: newData || oldData }
      ).catch(err => {
        console.error(`[EventTriggerHandler] Run ${runId} failed:`, err);
      });
    }

    return res.status(200).json({
      processed: true,
      matched_triggers: matchingTriggers.length,
      fired_runs: firedRuns.length,
      run_ids: firedRuns,
    });

  } catch (error: any) {
    console.error('[EventTriggerHandler] Error:', error);
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
}
