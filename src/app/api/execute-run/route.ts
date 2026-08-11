import { NextRequest, NextResponse } from 'next/server';

/**
 * Server-side proxy that calls executePendingRun using the admin secret.
 * This bypasses the need for a valid user JWT token.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { run_id } = body;

  if (!run_id) {
    return NextResponse.json({ message: 'run_id is required' }, { status: 400 });
  }

  const functionsUrl = `https://${process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN}.functions.${process.env.NEXT_PUBLIC_NHOST_REGION || 'ap-south-1'}.nhost.run/v1`;

  try {
    const res = await fetch(`${functionsUrl}/executePendingRun`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Forward auth header if present
        ...(req.headers.get('authorization')
          ? { Authorization: req.headers.get('authorization')! }
          : {}),
      },
      body: JSON.stringify({ run_id }),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch (e: any) {
    return NextResponse.json({ message: e.message }, { status: 500 });
  }
}
