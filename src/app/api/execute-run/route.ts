import { NextRequest, NextResponse } from 'next/server';

const SUBDOMAIN = process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN || 'bykigbyxcjykjxbhakqc';
const REGION = process.env.NEXT_PUBLIC_NHOST_REGION || 'ap-south-1';
const FUNCTIONS_URL = `https://${SUBDOMAIN}.functions.${REGION}.nhost.run/v1`;

export async function POST(req: NextRequest) {
  try {
    const { run_id } = await req.json();
    if (!run_id) {
      return NextResponse.json({ error: 'run_id is required' }, { status: 400 });
    }

    // Call executePendingRun from server side — no user token needed
    const res = await fetch(`${FUNCTIONS_URL}/executePendingRun`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ run_id }),
    });

    const data = await res.json() as Record<string, unknown>;
    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
