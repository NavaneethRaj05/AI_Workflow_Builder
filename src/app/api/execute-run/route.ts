import { NextRequest, NextResponse } from 'next/server';

const SUBDOMAIN = process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN || 'bykigbyxcjykjxbhakqc';
const REGION = process.env.NEXT_PUBLIC_NHOST_REGION || 'ap-south-1';
const FUNCTIONS_URL = `https://${SUBDOMAIN}.functions.${REGION}.nhost.run/v1`;
const ADMIN_SECRET = process.env.NHOST_ADMIN_SECRET || process.env.HASURA_GRAPHQL_ADMIN_SECRET || '';

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const { run_id } = await req.json();
    if (!run_id) {
      return NextResponse.json({ error: 'run_id is required' }, { status: 400 });
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authHeader) {
      headers['Authorization'] = authHeader;
    } else if (ADMIN_SECRET) {
      headers['x-hasura-admin-secret'] = ADMIN_SECRET;
    }

    const res = await fetch(`${FUNCTIONS_URL}/executePendingRun`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ run_id }),
    });

    const data = await res.json() as Record<string, unknown>;
    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

