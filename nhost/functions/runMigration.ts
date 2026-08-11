import type { Request, Response } from 'express';

/**
 * One-shot migration runner — DELETE THIS FILE after running.
 * Public endpoint — no auth needed, runs migration 4 only.
 */
export default async function handler(req: Request, res: Response) {
  // No auth check — this is a one-shot public migration endpoint

  const adminSecret = process.env.NHOST_ADMIN_SECRET;
  const hasuraUrl = process.env.NHOST_HASURA_URL?.replace('/console', '') ||
    'https://bykigbyxcjykjxbhakqc.hasura.ap-south-1.nhost.run';

  const results: Record<string, string> = {};

  // Migration 4: make workflow_triggers.created_by nullable
  try {
    const r = await fetch(`${hasuraUrl}/v2/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hasura-admin-secret': adminSecret!,
      },
      body: JSON.stringify({
        type: 'run_sql',
        args: {
          source: 'default',
          sql: 'ALTER TABLE public.workflow_triggers ALTER COLUMN created_by DROP NOT NULL;',
          cascade: false,
          read_only: false,
        },
      }),
    });
    const data = await r.json() as Record<string, unknown>;
    results.migration4 = r.ok ? 'OK' : `FAILED: ${JSON.stringify(data)}`;
  } catch (e: unknown) {
    results.migration4 = `ERROR: ${e instanceof Error ? e.message : String(e)}`;
  }

  // Reload metadata
  try {
    const r = await fetch(`${hasuraUrl}/v1/metadata`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hasura-admin-secret': adminSecret!,
      },
      body: JSON.stringify({ type: 'reload_metadata', args: { reload_remote_schemas: true } }),
    });
    results.metadataReload = r.ok ? 'OK' : `FAILED: ${r.status}`;
  } catch (e: unknown) {
    results.metadataReload = `ERROR: ${e instanceof Error ? e.message : String(e)}`;
  }

  return res.status(200).json({
    results,
    admin_secret_set: !!adminSecret,
    hasura_url: hasuraUrl,
  });
}
