import { gql } from '@apollo/client';

// ============================================================
// Queries
// ============================================================

export const GET_MY_ORGS = gql`
  query GetMyOrgs {
    org_members {
      role
      organization {
        id
        name
        slug
        quota_limit
        quota_used
        quota_reset_at
        quota_remaining
      }
    }
  }
`;

export const GET_ORG_WORKFLOWS = gql`
  query GetOrgWorkflows($org_id: uuid!) {
    workflows(where: { org_id: { _eq: $org_id } }, order_by: { updated_at: desc }) {
      id
      name
      description
      is_active
      created_at
      updated_at
      workflow_steps(order_by: { step_order: asc }) {
        id
        name
        step_type
        step_order
        config
        is_enabled
      }
      workflow_triggers {
        id
        trigger_type
        config
        is_active
      }
      workflow_runs(order_by: { started_at: desc }, limit: 1) {
        id
        status
        started_at
        completed_at
        trigger_type
      }
    }
  }
`;

export const GET_WORKFLOW_DETAIL = gql`
  query GetWorkflowDetail($id: uuid!) {
    workflows_by_pk(id: $id) {
      id
      name
      description
      is_active
      org_id
      created_at
      updated_at
      workflow_steps(order_by: { step_order: asc }) {
        id
        name
        step_type
        step_order
        config
        is_enabled
      }
      workflow_triggers {
        id
        trigger_type
        config
        is_active
        webhook_secret
      }
      workflow_runs(order_by: { started_at: desc }, limit: 5) {
        id
        status
        started_at
        completed_at
        trigger_type
        total_steps
        completed_steps
      }
    }
  }
`;

export const GET_RUN_DETAIL = gql`
  query GetRunDetail($id: uuid!) {
    workflow_runs_by_pk(id: $id) {
      id
      status
      started_at
      completed_at
      trigger_type
      input
      output
      error
      total_steps
      completed_steps
      workflow {
        id
        name
        org_id
      }
    }
  }
`;

export const GET_ORG_MEMBERS = gql`
  query GetOrgMembers($org_id: uuid!) {
    org_members(where: { org_id: { _eq: $org_id } }) {
      id
      role
      created_at
      user {
        id
        email
        displayName
        avatarUrl
      }
    }
  }
`;

export const GET_ORG_NOTIFICATIONS = gql`
  query GetOrgNotifications($org_id: uuid!, $limit: Int = 20) {
    notifications(
      where: { org_id: { _eq: $org_id } }
      order_by: { sent_at: desc }
      limit: $limit
    ) {
      id
      channel
      title
      message
      status
      sent_at
      workflow_run { id status }
    }
  }
`;

// ============================================================
// Subscriptions — Live step progress
// ============================================================

export const SUBSCRIBE_STEP_RUNS = gql`
  subscription SubscribeStepRuns($workflow_run_id: uuid!) {
    step_runs(
      where: { workflow_run_id: { _eq: $workflow_run_id } }
      order_by: { workflow_step: { step_order: asc } }
    ) {
      id
      status
      input
      output
      error
      attempt_count
      started_at
      completed_at
      approved_by
      approved_at
      approval_comment
      workflow_step {
        id
        name
        step_type
        step_order
        config
      }
    }
  }
`;

export const SUBSCRIBE_WORKFLOW_RUN = gql`
  subscription SubscribeWorkflowRun($id: uuid!) {
    workflow_runs_by_pk(id: $id) {
      id
      status
      started_at
      completed_at
      trigger_type
      output
      error
      paused_at_step_id
      total_steps
      completed_steps
    }
  }
`;

// ============================================================
// Mutations
// ============================================================

export const UPSERT_WORKFLOW = gql`
  mutation UpsertWorkflow(
    $id: uuid
    $name: String!
    $description: String
    $org_id: uuid!
    $is_active: Boolean!
  ) {
    insert_workflows_one(
      object: {
        id: $id
        name: $name
        description: $description
        org_id: $org_id
        is_active: $is_active
      }
      on_conflict: {
        constraint: workflows_pkey
        update_columns: [name, description, is_active, updated_at]
      }
    ) {
      id
      name
    }
  }
`;

export const INSERT_WORKFLOW_STEPS = gql`
  mutation InsertWorkflowSteps($steps: [workflow_steps_insert_input!]!) {
    insert_workflow_steps(
      objects: $steps
      on_conflict: {
        constraint: workflow_steps_pkey
        update_columns: [name, step_order, step_type, config, is_enabled, updated_at]
      }
    ) {
      returning {
        id
        name
        step_type
        step_order
      }
    }
  }
`;

export const DELETE_WORKFLOW_STEPS = gql`
  mutation DeleteWorkflowSteps($ids: [uuid!]!) {
    delete_workflow_steps(where: { id: { _in: $ids } }) {
      affected_rows
    }
  }
`;

export const UPSERT_WORKFLOW_TRIGGER = gql`
  mutation UpsertWorkflowTrigger(
    $id: uuid
    $workflow_id: uuid!
    $trigger_type: trigger_type!
    $config: jsonb!
    $is_active: Boolean!
  ) {
    insert_workflow_triggers_one(
      object: {
        id: $id
        workflow_id: $workflow_id
        trigger_type: $trigger_type
        config: $config
        is_active: $is_active
      }
      on_conflict: {
        constraint: workflow_triggers_pkey
        update_columns: [trigger_type, config, is_active]
      }
    ) {
      id
      trigger_type
    }
  }
`;

export const TRIGGER_WORKFLOW_RUN = gql`
  mutation TriggerWorkflowRun($workflow_id: uuid!, $initial_input: jsonb) {
    triggerWorkflowRun(workflow_id: $workflow_id, initial_input: $initial_input) {
      run_id
      status
      message
    }
  }
`;

export const APPROVE_STEP = gql`
  mutation ApproveStep($step_run_id: uuid!, $comment: String) {
    approveStep(step_run_id: $step_run_id, comment: $comment) {
      success
      message
    }
  }
`;

export const UPDATE_ORG_MEMBER_ROLE = gql`
  mutation UpdateOrgMemberRole($id: uuid!, $role: org_member_role!) {
    update_org_members_by_pk(
      pk_columns: { id: $id }
      _set: { role: $role }
    ) {
      id
      role
    }
  }
`;

export const REMOVE_ORG_MEMBER = gql`
  mutation RemoveOrgMember($id: uuid!) {
    delete_org_members_by_pk(id: $id) {
      id
    }
  }
`;

export const CREATE_ORGANIZATION = gql`
  mutation CreateOrganization($name: String!, $slug: String!) {
    insert_organizations_one(object: { name: $name, slug: $slug }) {
      id
      name
      slug
      quota_limit
      quota_used
      quota_reset_at
    }
  }
`;

export const ADD_ORG_MEMBER = gql`
  mutation AddOrgMember($org_id: uuid!, $user_id: uuid!, $role: org_member_role!) {
    insert_org_members_one(
      object: { org_id: $org_id, user_id: $user_id, role: $role }
      on_conflict: { constraint: org_members_org_id_user_id_key, update_columns: [role] }
    ) {
      id
      role
      user {
        id
        email
        displayName
      }
    }
  }
`;

export const DELETE_WORKFLOW = gql`
  mutation DeleteWorkflow($id: uuid!) {
    delete_workflows_by_pk(id: $id) {
      id
    }
  }
`;

export const GET_ORG_RUNS = gql`
  query GetOrgRuns($org_id: uuid!, $limit: Int = 30) {
    workflow_runs(
      where: { org_id: { _eq: $org_id } }
      order_by: { started_at: desc }
      limit: $limit
    ) {
      id
      status
      trigger_type
      started_at
      completed_at
      total_steps
      completed_steps
      workflow {
        id
        name
      }
    }
  }
`;

export const SUBSCRIBE_ORG_NOTIFICATIONS = gql`
  subscription SubscribeOrgNotifications($org_id: uuid!, $limit: Int = 30) {
    notifications(
      where: { org_id: { _eq: $org_id } }
      order_by: { sent_at: desc }
      limit: $limit
    ) {
      id
      channel
      title
      message
      status
      sent_at
      payload
      workflow_run {
        id
        status
        workflow {
          id
          name
        }
      }
    }
  }
`;

export const GET_USERS_BY_EMAIL = gql`
  query GetUsersByEmail($email: citext!) {
    users(where: { email: { _eq: $email } }) {
      id
      email
      displayName
      avatarUrl
    }
  }
`;
