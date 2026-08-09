import { GraphQLClient, gql } from 'graphql-request';

// Admin GraphQL client (bypasses row-level security)
export const adminClient = new GraphQLClient(
  process.env.NHOST_GRAPHQL_URL || `https://${process.env.NHOST_SUBDOMAIN}.hasura.${process.env.NHOST_REGION}.nhost.run/v1/graphql`,
  {
    headers: {
      'x-hasura-admin-secret': process.env.NHOST_ADMIN_SECRET!,
    },
  }
);

// Authenticated client (respects row-level security)
export function userClient(userId: string, userRole: string) {
  return new GraphQLClient(
    process.env.NHOST_GRAPHQL_URL || `https://${process.env.NHOST_SUBDOMAIN}.hasura.${process.env.NHOST_REGION}.nhost.run/v1/graphql`,
    {
      headers: {
        'x-hasura-admin-secret': process.env.NHOST_ADMIN_SECRET!,
        'x-hasura-user-id': userId,
        'x-hasura-role': userRole,
      },
    }
  );
}

// ============================================================
// Shared Queries/Mutations
// ============================================================

export const GET_USER_ORG_ROLE = gql`
  query GetUserOrgRole($user_id: uuid!, $org_id: uuid!) {
    org_members(where: {user_id: {_eq: $user_id}, org_id: {_eq: $org_id}}) {
      role
    }
  }
`;

export const GET_WORKFLOW_WITH_STEPS = gql`
  query GetWorkflowWithSteps($workflow_id: uuid!) {
    workflows_by_pk(id: $workflow_id) {
      id
      org_id
      name
      is_active
      workflow_steps(order_by: {step_order: asc}) {
        id
        name
        step_order
        step_type
        config
        is_enabled
      }
    }
  }
`;

export const GET_STEP_RUN_WITH_CONTEXT = gql`
  query GetStepRunWithContext($step_run_id: uuid!) {
    step_runs_by_pk(id: $step_run_id) {
      id
      status
      workflow_run_id
      workflow_step_id
      workflow_run {
        id
        org_id
        workflow_id
        status
        workflow {
          org_id
        }
      }
      workflow_step {
        step_type
        config
      }
    }
  }
`;

export const CREATE_WORKFLOW_RUN = gql`
  mutation CreateWorkflowRun($object: workflow_runs_insert_input!) {
    insert_workflow_runs_one(object: $object) {
      id
    }
  }
`;

export const CREATE_STEP_RUN = gql`
  mutation CreateStepRun($object: step_runs_insert_input!) {
    insert_step_runs_one(object: $object) {
      id
    }
  }
`;

export const UPDATE_STEP_RUN = gql`
  mutation UpdateStepRun($id: uuid!, $set: step_runs_set_input!) {
    update_step_runs_by_pk(pk_columns: {id: $id}, _set: $set) {
      id
      status
    }
  }
`;

export const UPDATE_WORKFLOW_RUN = gql`
  mutation UpdateWorkflowRun($id: uuid!, $set: workflow_runs_set_input!) {
    update_workflow_runs_by_pk(pk_columns: {id: $id}, _set: $set) {
      id
      status
    }
  }
`;

export const CHECK_AND_INCREMENT_QUOTA = gql`
  mutation CheckAndIncrementQuota($org_id: uuid!) {
    check_and_increment_quota(args: {p_org_id: $org_id})
  }
`;

export const INCREMENT_ORG_QUOTA = gql`
  mutation IncrementOrgQuota($org_id: uuid!) {
    update_organizations_by_pk(
      pk_columns: {id: $org_id},
      _inc: {quota_used: 1}
    ) {
      id
      quota_used
    }
  }
`;

export const INSERT_NOTIFICATION = gql`
  mutation InsertNotification($object: notifications_insert_input!) {
    insert_notifications_one(object: $object) {
      id
    }
  }
`;

export const DB_WRITE_RESULT = gql`
  mutation DbWriteResult($object: notifications_insert_input!) {
    insert_notifications_one(object: $object) {
      id
    }
  }
`;

// ============================================================
// Helper: Get user role in org
// ============================================================
export async function getUserOrgRole(userId: string, orgId: string): Promise<string | null> {
  const data: any = await adminClient.request(GET_USER_ORG_ROLE, {
    user_id: userId,
    org_id: orgId,
  });
  return data?.org_members?.[0]?.role || null;
}

// ============================================================
// Helper: Verify action secret from Hasura
// ============================================================
export function verifyActionSecret(req: Request): boolean {
  const secret = process.env.NHOST_WEBHOOK_SECRET;
  if (!secret) return true; // No secret configured, allow (dev mode)
  const header = (req.headers as any)['x-hasura-action-secret'];
  return header === secret;
}

// ============================================================
// Retry helper for external calls
// ============================================================
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      if (attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs * Math.pow(2, attempt)));
      }
    }
  }
  throw lastError!;
}
