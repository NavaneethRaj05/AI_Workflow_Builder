import { NextRequest, NextResponse } from 'next/server';

const HASURA_URL = `https://${process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN || 'bykigbyxcjykjxbhakqc'}.hasura.ap-south-1.nhost.run`;
const GRAPHQL_URL = `https://${process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN || 'bykigbyxcjykjxbhakqc'}.graphql.ap-south-1.nhost.run/v1`;
const FUNCTIONS_URL = `https://${process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN || 'bykigbyxcjykjxbhakqc'}.functions.ap-south-1.nhost.run/v1`;
const ADMIN_SECRET = process.env.NHOST_ADMIN_SECRET || process.env.HASURA_GRAPHQL_ADMIN_SECRET || '';

async function gql(query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': ADMIN_SECRET,
    },
    body: JSON.stringify({ query, variables }),
  });
  return res.json() as Promise<{ data?: Record<string, unknown>; errors?: { message: string }[] }>;
}

export async function POST(req: NextRequest) {
  try {
    const { workflow_id, org_id } = await req.json();

    if (!workflow_id || !org_id) {
      return NextResponse.json({ error: 'workflow_id and org_id are required' }, { status: 400 });
    }

    // 1. Create workflow run
    const createRes = await gql(`
      mutation CreateRun($workflow_id: uuid!, $org_id: uuid!) {
        insert_workflow_runs_one(object: {
          workflow_id: $workflow_id
          org_id: $org_id
          trigger_type: manual
          status: pending
          input: {}
        }) { id }
      }
    `, { workflow_id, org_id });

    if (createRes.errors) {
      return NextResponse.json({ error: createRes.errors[0].message }, { status: 500 });
    }

    const run_id = (createRes.data?.insert_workflow_runs_one as { id: string })?.id;
    if (!run_id) {
      return NextResponse.json({ error: 'Failed to create run' }, { status: 500 });
    }

    // 2. Fire executePendingRun — don't await, let it run async
    fetch(`${FUNCTIONS_URL}/executePendingRun`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ run_id }),
    }).catch(() => {/* background execution */});

    return NextResponse.json({ run_id, status: 'started' });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
