/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import * as vm from 'vm';
import {
  adminClient,
  getUserOrgRole,
  withRetry,
  CREATE_WORKFLOW_RUN,
  CREATE_STEP_RUN,
  UPDATE_STEP_RUN,
  UPDATE_WORKFLOW_RUN,
  GET_WORKFLOW_WITH_STEPS,
  INSERT_NOTIFICATION,
} from './graphqlClient';
import { gql } from 'graphql-request';

type StepType = 'llm_call' | 'http_request' | 'db_write' | 'notify' | 'conditional_branch' | 'approval_gate';

interface WorkflowStep {
  id: string;
  name: string;
  step_order: number;
  step_type: StepType;
  config: Record<string, any>;
  is_enabled: boolean;
}

interface WorkflowRun {
  id: string;
  org_id: string;
}

// ============================================================
// Main execution engine for workflow runs
// ============================================================
export async function executeWorkflow(
  workflowId: string,
  runId: string,
  orgId: string,
  userId: string | null,
  inputPayload: any = {}
) {
  // Fetch workflow with all steps
  const workflowData: any = await adminClient.request(GET_WORKFLOW_WITH_STEPS, {
    workflow_id: workflowId,
  });

  const workflow = workflowData?.workflows_by_pk;
  if (!workflow) throw new Error('Workflow not found');

  const steps: WorkflowStep[] = workflow.workflow_steps.filter((s: WorkflowStep) => s.is_enabled);

  // Update run to 'running'
  await adminClient.request(UPDATE_WORKFLOW_RUN, {
    id: runId,
    set: { status: 'running' },
  });

  let previousOutput: any = inputPayload;
  let runFailed = false;

  for (const step of steps) {
    // Create step_run record
    const stepRunData: any = await adminClient.request(CREATE_STEP_RUN, {
      object: {
        workflow_run_id: runId,
        workflow_step_id: step.id,
        status: 'pending',
        input: previousOutput,
      },
    });

    const stepRunId = stepRunData?.insert_step_runs_one?.id;

    // Mark step as running
    await adminClient.request(UPDATE_STEP_RUN, {
      id: stepRunId,
      set: {
        status: 'running',
        started_at: new Date().toISOString(),
        attempt_count: 1,
      },
    });

    try {
      let output: any;

      switch (step.step_type) {
        case 'llm_call':
          output = await executeLlmCall(step, previousOutput, stepRunId);
          break;
        case 'http_request':
          output = await executeHttpRequest(step, previousOutput, stepRunId);
          break;
        case 'db_write':
          output = await executeDbWrite(step, previousOutput, orgId, runId, stepRunId);
          break;
        case 'notify':
          output = await executeNotify(step, previousOutput, orgId, runId, stepRunId);
          break;
        case 'conditional_branch':
          output = executeConditionalBranch(step, previousOutput);
          break;
        case 'approval_gate':
          // Pause the run — return immediately
          await adminClient.request(UPDATE_STEP_RUN, {
            id: stepRunId,
            set: { status: 'awaiting_approval' },
          });
          await adminClient.request(UPDATE_WORKFLOW_RUN, {
            id: runId,
            set: {
              status: 'paused',
              paused_at_step_id: step.id,
            },
          });
          console.log(`[WorkflowEngine] Run ${runId} paused at approval_gate step ${step.id}`);
          return { status: 'paused', paused_at_step_id: step.id, run_id: runId };
        default:
          throw new Error(`Unknown step type: ${step.step_type}`);
      }

      // Step succeeded
      await adminClient.request(UPDATE_STEP_RUN, {
        id: stepRunId,
        set: {
          status: 'succeeded',
          output: output,
          completed_at: new Date().toISOString(),
        },
      });

      previousOutput = output;
    } catch (error: any) {
      console.error(`[WorkflowEngine] Step ${step.id} failed:`, error.message);
      await adminClient.request(UPDATE_STEP_RUN, {
        id: stepRunId,
        set: {
          status: 'failed',
          error: error.message,
          completed_at: new Date().toISOString(),
        },
      });
      await adminClient.request(UPDATE_WORKFLOW_RUN, {
        id: runId,
        set: {
          status: 'failed',
          completed_at: new Date().toISOString(),
          output: { error: error.message, failed_at_step: step.id },
        },
      });
      runFailed = true;
      break;
    }
  }

  if (!runFailed) {
    await adminClient.request(UPDATE_WORKFLOW_RUN, {
      id: runId,
      set: {
        status: 'completed',
        completed_at: new Date().toISOString(),
        output: previousOutput,
      },
    });

    // Increment quota
    await adminClient.request(gql`
      mutation IncrementQuota($org_id: uuid!) {
        update_organizations_by_pk(
          pk_columns: {id: $org_id}
          _inc: {quota_used: 1}
        ) { id quota_used }
      }
    `, { org_id: orgId });

    return { status: 'completed', run_id: runId };
  }

  return { status: 'failed', run_id: runId };
}

// ============================================================
// Continue a workflow from a specific step (after approval)
// ============================================================
export async function continueWorkflowFromStep(
  runId: string,
  resumeFromStepId: string,
  approverOutput: any = {}
) {
  const runData: any = await adminClient.request(gql`
    query GetRun($id: uuid!) {
      workflow_runs_by_pk(id: $id) {
        id
        org_id
        workflow_id
        triggered_by
        step_runs(order_by: {workflow_step: {step_order: asc}}) {
          id
          status
          output
          workflow_step_id
          workflow_step { step_order step_type config name is_enabled id }
        }
      }
    }
  `, { id: runId });

  const run = runData?.workflow_runs_by_pk;
  if (!run) throw new Error('Run not found');

  // Find resume point
  const allSteps = run.step_runs
    .map((sr: any) => sr.workflow_step)
    .filter((s: any) => s.is_enabled)
    .sort((a: any, b: any) => a.step_order - b.step_order);

  const resumeIndex = allSteps.findIndex((s: any) => s.id === resumeFromStepId);
  if (resumeIndex === -1) throw new Error('Resume step not found');

  const remainingSteps = allSteps.slice(resumeIndex + 1); // Steps AFTER the approval gate

  // Get previous output (from last succeeded step_run)
  const lastSucceeded = run.step_runs
    .filter((sr: any) => sr.status === 'succeeded')
    .sort((a: any, b: any) => {
      const aOrder = a.workflow_step?.step_order || 0;
      const bOrder = b.workflow_step?.step_order || 0;
      return bOrder - aOrder;
    })[0];

  let previousOutput = lastSucceeded?.output || approverOutput;

  // Update run to running
  await adminClient.request(UPDATE_WORKFLOW_RUN, {
    id: runId,
    set: { status: 'running', paused_at_step_id: null },
  });

  let runFailed = false;

  for (const step of remainingSteps) {
    const stepRunData: any = await adminClient.request(CREATE_STEP_RUN, {
      object: {
        workflow_run_id: runId,
        workflow_step_id: step.id,
        status: 'pending',
        input: previousOutput,
      },
    });

    const stepRunId = stepRunData?.insert_step_runs_one?.id;
    await adminClient.request(UPDATE_STEP_RUN, {
      id: stepRunId,
      set: { status: 'running', started_at: new Date().toISOString(), attempt_count: 1 },
    });

    try {
      let output: any;
      switch (step.step_type) {
        case 'llm_call':
          output = await executeLlmCall(step, previousOutput, stepRunId);
          break;
        case 'http_request':
          output = await executeHttpRequest(step, previousOutput, stepRunId);
          break;
        case 'db_write':
          output = await executeDbWrite(step, previousOutput, run.org_id, runId, stepRunId);
          break;
        case 'notify':
          output = await executeNotify(step, previousOutput, run.org_id, runId, stepRunId);
          break;
        case 'conditional_branch':
          output = executeConditionalBranch(step, previousOutput);
          break;
        case 'approval_gate':
          await adminClient.request(UPDATE_STEP_RUN, { id: stepRunId, set: { status: 'awaiting_approval' } });
          await adminClient.request(UPDATE_WORKFLOW_RUN, { id: runId, set: { status: 'paused', paused_at_step_id: step.id } });
          return { status: 'paused', paused_at_step_id: step.id };
        default:
          throw new Error(`Unknown step type: ${step.step_type}`);
      }

      await adminClient.request(UPDATE_STEP_RUN, {
        id: stepRunId,
        set: { status: 'succeeded', output, completed_at: new Date().toISOString() },
      });
      previousOutput = output;
    } catch (error: any) {
      await adminClient.request(UPDATE_STEP_RUN, {
        id: stepRunId,
        set: { status: 'failed', error: error.message, completed_at: new Date().toISOString() },
      });
      await adminClient.request(UPDATE_WORKFLOW_RUN, {
        id: runId,
        set: { status: 'failed', completed_at: new Date().toISOString() },
      });
      runFailed = true;
      break;
    }
  }

  if (!runFailed) {
    await adminClient.request(UPDATE_WORKFLOW_RUN, {
      id: runId,
      set: { status: 'completed', completed_at: new Date().toISOString(), output: previousOutput },
    });
    await adminClient.request(gql`
      mutation IncrementQuota($org_id: uuid!) {
        update_organizations_by_pk(pk_columns: {id: $org_id}, _inc: {quota_used: 1}) { id }
      }
    `, { org_id: run.org_id });
    return { status: 'completed' };
  }

  return { status: 'failed' };
}

// ============================================================
// Step Executors
// ============================================================

async function executeLlmCall(step: WorkflowStep, input: any, stepRunId: string): Promise<any> {
  const config = step.config;
  const model = config.model || 'llama-3.3-70b-versatile';
  const systemPrompt = config.system_prompt || 'You are a helpful AI assistant.';
  const userPromptTemplate = config.user_prompt || 'Process this: {{input}}';

  // Interpolate input into prompt
  const userPrompt = userPromptTemplate.replace(
    /\{\{(\w+)\}\}/g,
    (_: string, key: string) => {
      if (key === 'input') return typeof input === 'string' ? input : JSON.stringify(input);
      return input?.[key] ?? `{{${key}}}`;
    }
  );

  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    // Stub: artificial delay + fake response
    await new Promise(r => setTimeout(r, 2000));
    return {
      llm_response: `[STUBBED] AI response to: ${userPrompt.substring(0, 100)}`,
      model: 'stubbed',
      tokens_used: 0,
    };
  }

  return await withRetry(async () => {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: config.max_tokens || 500,
        temperature: config.temperature || 0.7,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Groq API error ${response.status}: ${error}`);
    }

    const data: any = await response.json();
    return {
      llm_response: data.choices?.[0]?.message?.content || '',
      model: data.model,
      tokens_used: data.usage?.total_tokens || 0,
    };
  }, 3);
}

async function executeHttpRequest(step: WorkflowStep, input: any, stepRunId: string): Promise<any> {
  const config = step.config;
  const url = config.url || 'https://httpbin.org/post';
  const method = (config.method || 'POST').toUpperCase();
  const headers = config.headers || { 'Content-Type': 'application/json' };
  const bodyTemplate = config.body_template;

  // Build request body
  let body: string | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    body = bodyTemplate
      ? JSON.stringify(
          typeof bodyTemplate === 'string'
            ? bodyTemplate.replace(/\{\{input\}\}/g, JSON.stringify(input))
            : bodyTemplate
        )
      : JSON.stringify({ input, step: step.name });
  }

  return await withRetry(async () => {
    const response = await fetch(url, {
      method,
      headers,
      body,
    });

    const responseText = await response.text();
    let responseData: any;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { raw_response: responseText };
    }

    return {
      status_code: response.status,
      ok: response.ok,
      response: responseData,
      url,
      method,
    };
  }, 3);
}

async function executeDbWrite(
  step: WorkflowStep,
  input: any,
  orgId: string,
  runId: string,
  stepRunId: string
): Promise<any> {
  // Write result to notifications table (or a custom table if configured)
  const config = step.config;
  const title = config.title || `Step result: ${step.name}`;
  const message = config.message_template
    ? config.message_template.replace(/\{\{input\}\}/g, JSON.stringify(input))
    : JSON.stringify(input);

  const result: any = await adminClient.request(INSERT_NOTIFICATION, {
    object: {
      org_id: orgId,
      workflow_run_id: runId,
      step_run_id: stepRunId,
      channel: 'db_write',
      title,
      message,
      payload: { input, step_name: step.name },
    },
  });

  return {
    written: true,
    notification_id: result?.insert_notifications_one?.id,
    message,
  };
}

async function executeNotify(
  step: WorkflowStep,
  input: any,
  orgId: string,
  runId: string,
  stepRunId: string
): Promise<any> {
  const config = step.config;
  const channel = config.channel || 'system';
  const title = config.title || `Workflow Notification: ${step.name}`;
  const messageTemplate = config.message || 'Workflow step completed with output: {{input}}';
  const message = messageTemplate.replace(/\{\{input\}\}/g, JSON.stringify(input));

  // Save notification to DB first
  await adminClient.request(INSERT_NOTIFICATION, {
    object: {
      org_id: orgId,
      workflow_run_id: runId,
      step_run_id: stepRunId,
      channel,
      title,
      message,
      payload: input,
    },
  });

  // Attempt Slack if configured
  if (channel === 'slack' && config.slack_webhook_url) {
    try {
      await fetch(config.slack_webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `*${title}*\n${message}`,
          blocks: [
            { type: 'header', text: { type: 'plain_text', text: title } },
            { type: 'section', text: { type: 'mrkdwn', text: `\`\`\`${message}\`\`\`` } },
          ],
        }),
      });
    } catch (e: any) {
      console.warn('[NotifyStep] Slack delivery failed:', e.message);
    }
  }

  return { notified: true, channel, title, message };
}

function executeConditionalBranch(step: WorkflowStep, input: any): any {
  const config = step.config;
  const condition = config.condition || '';
  const trueOutput = config.true_output || { branch: 'true', input };
  const falseOutput = config.false_output || { branch: 'false', input };

  let conditionResult = false;

  try {
    // Sandbox condition evaluation
    const inputValue = typeof input === 'object' ? input : { value: input };
    // Provide both 'input' and 'output' to support existing workflows
    const context = vm.createContext({ input: inputValue, output: inputValue });
    
    const result = vm.runInContext(`!!(${condition})`, context, { timeout: 100 });
    conditionResult = result === true;
  } catch (e: any) {
    console.error('[ConditionalBranch] Condition evaluation error:', e.message);
    conditionResult = false;
  }

  return {
    condition_met: conditionResult,
    branch: conditionResult ? 'true' : 'false',
    output: conditionResult ? trueOutput : falseOutput,
    evaluated_condition: condition,
    input,
  };
}
