/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useApolloClient } from '@apollo/client';
import { useUserData } from '@nhost/react';
import { gql } from '@apollo/client';
import { useOrgStore } from './store';

const CREATE_ORG_MUTATION = gql`
  mutation SetupCreateOrg($name: String!, $slug: String!) {
    insert_organizations_one(object: { name: $name, slug: $slug }) {
      id
      name
      slug
    }
  }
`;

const ADD_SELF_AS_OWNER = gql`
  mutation SetupAddOwner($org_id: uuid!, $user_id: uuid!) {
    insert_org_members_one(object: { org_id: $org_id, user_id: $user_id, role: owner }) {
      id
    }
  }
`;

const SEED_WORKFLOW = gql`
  mutation SeedWorkflow(
    $name: String!
    $description: String
    $org_id: uuid!
    $created_by: uuid!
  ) {
    insert_workflows_one(
      object: {
        name: $name
        description: $description
        org_id: $org_id
        is_active: true
        created_by: $created_by
      }
    ) {
      id
    }
  }
`;

const SEED_STEPS = gql`
  mutation SeedSteps($steps: [workflow_steps_insert_input!]!) {
    insert_workflow_steps(objects: $steps) {
      returning { id }
    }
  }
`;

const SEED_TRIGGER = gql`
  mutation SeedTrigger(
    $workflow_id: uuid!
    $trigger_type: trigger_type!
    $config: jsonb!
  ) {
    insert_workflow_triggers_one(
      object: {
        workflow_id: $workflow_id
        trigger_type: $trigger_type
        config: $config
        is_active: true
      }
    ) {
      id
    }
  }
`;

const DEMO_WORKFLOWS = [
  {
    name: 'AI Customer Support Pipeline',
    description: 'Classifies inbound support tickets with LLM, branches to appropriate team, sends Slack notification, and logs to database.',
    trigger: 'webhook',
    triggerConfig: { url_suffix: '/webhook/support' },
    steps: [
      { name: 'Classify Ticket', step_type: 'llm_call', step_order: 0, config: { model: 'llama3-8b-8192', prompt: 'Classify the support ticket: {{input.message}}. Categories: billing, technical, general.' } },
      { name: 'Branch by Category', step_type: 'conditional_branch', step_order: 1, config: { condition: 'output.category === "technical"', true_label: 'Technical', false_label: 'Other' } },
      { name: 'Notify Support Team', step_type: 'notify', step_order: 2, config: { channel: 'slack', message: 'New {{category}} ticket: {{output.summary}}' } },
      { name: 'Log to DB', step_type: 'db_write', step_order: 3, config: { table: 'support_tickets', fields: { category: '{{output.category}}', status: 'open' } } },
      { name: 'Approval Gate', step_type: 'approval_gate', step_order: 4, config: { description: 'Review high-priority tickets before escalating', required_role: 'editor' } },
    ],
  },
  {
    name: 'Scheduled Daily Digest',
    description: 'Runs every morning, fetches news via HTTP, summarizes with LLM, and emails the digest to the team.',
    trigger: 'scheduled',
    triggerConfig: { cron: '0 9 * * *', timezone: 'UTC' },
    steps: [
      { name: 'Fetch Latest News', step_type: 'http_request', step_order: 0, config: { method: 'GET', url: 'https://hacker-news.firebaseio.com/v0/topstories.json', description: 'Fetch top HN story IDs' } },
      { name: 'Summarize with LLM', step_type: 'llm_call', step_order: 1, config: { model: 'llama3-8b-8192', prompt: 'Summarize these Hacker News top stories for a morning digest: {{input.ids}}' } },
      { name: 'Send Email Digest', step_type: 'notify', step_order: 2, config: { channel: 'email', subject: 'Morning AI Digest', message: '{{output.summary}}' } },
    ],
  },
  {
    name: 'Content Moderation Workflow',
    description: 'Moderates user-submitted content using LLM analysis, auto-approves safe content, flags problematic content for human review.',
    trigger: 'manual',
    triggerConfig: {},
    steps: [
      { name: 'Analyze Content', step_type: 'llm_call', step_order: 0, config: { model: 'llama3-8b-8192', prompt: 'Analyze this content for violations: {{input.content}}. Return JSON: {safe: bool, reason: string, score: number}' } },
      { name: 'Safety Branch', step_type: 'conditional_branch', step_order: 1, config: { condition: 'output.safe === true', true_label: 'Safe - Auto Approve', false_label: 'Flagged - Human Review' } },
      { name: 'Human Review Gate', step_type: 'approval_gate', step_order: 2, config: { description: 'Flagged content requires manual review before action', required_role: 'editor' } },
      { name: 'Update Moderation Log', step_type: 'db_write', step_order: 3, config: { table: 'moderation_log', fields: { status: 'reviewed', action: '{{output.decision}}' } } },
    ],
  },
];

export function useFirstTimeSetup(hasOrgs: boolean, orgsLoaded: boolean) {
  const user = useUserData();
  const { setSelectedOrg } = useOrgStore();
  const [isSeeding, setIsSeeding] = useState(false);
  const [seedComplete, setSeedComplete] = useState(false);
  const seededRef = useRef(false);
  const client = useApolloClient();

  const [createOrg] = useMutation(CREATE_ORG_MUTATION);
  const [addSelfAsOwner] = useMutation(ADD_SELF_AS_OWNER);
  const [seedWorkflow] = useMutation(SEED_WORKFLOW);
  const [seedSteps] = useMutation(SEED_STEPS);
  const [seedTrigger] = useMutation(SEED_TRIGGER);

  useEffect(() => {
    if (seededRef.current) return;
    if (!orgsLoaded) return;
    if (hasOrgs) return;
    if (!user?.id) return;

    const key = `flowforge_seeded_${user.id}`;
    if (localStorage.getItem(key)) return;

    seededRef.current = true;
    setIsSeeding(true);

    (async () => {
      try {
        // 1. Create Org A
        const orgResult = await createOrg({
          variables: { name: 'Acme Corp', slug: `acme-${user.id.slice(0, 8)}` },
        });
        const orgId = orgResult.data?.insert_organizations_one?.id;
        if (!orgId) throw new Error('Failed to create org');

        // 2. Add self as owner
        await addSelfAsOwner({ variables: { org_id: orgId, user_id: user.id } });

        // 3. Select it
        setSelectedOrg(orgId, 'owner');

        // 4. Seed demo workflows
        for (const demo of DEMO_WORKFLOWS) {
          const wfResult = await seedWorkflow({
            variables: {
              name: demo.name,
              description: demo.description,
              org_id: orgId,
              created_by: user.id,
            },
          });
          const wfId = wfResult.data?.insert_workflows_one?.id;
          if (!wfId) continue;

          // Steps
          await seedSteps({
            variables: {
              steps: demo.steps.map((s) => ({
                ...s,
                workflow_id: wfId,
                is_enabled: true,
              })),
            },
          });

          // Trigger
          await seedTrigger({
            variables: {
              workflow_id: wfId,
              trigger_type: demo.trigger as any,
              config: demo.triggerConfig,
            },
          });
        }

        localStorage.setItem(key, '1');
        // Refetch all org data
        await client.refetchQueries({ include: 'active' });
        setSeedComplete(true);
      } catch (err) {
        console.error('First-time setup failed:', err);
        seededRef.current = false;
      } finally {
        setIsSeeding(false);
      }
    })();
  }, [hasOrgs, orgsLoaded, user?.id]);

  return { isSeeding, seedComplete };
}
