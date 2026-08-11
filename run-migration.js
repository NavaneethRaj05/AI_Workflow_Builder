/**
 * Run pending migrations against the live Nhost/Hasura instance.
 * 
 * Usage:
 *   node run-migration.js <admin-secret>
 * 
 * The admin secret is in Nhost Dashboard → Settings → Secrets
 *   → HASURA_GRAPHQL_ADMIN_SECRET → ⋮ Edit (to reveal current value)
 */

const fs = require('fs');
const path = require('path');

const HASURA_URL = 'https://bykigbyxcjykjxbhakqc.hasura.ap-south-1.nhost.run';
const ADMIN_SECRET = process.argv[2];

if (!ADMIN_SECRET) {
  console.error('ERROR: Admin secret is required.');
  console.error('Usage: node run-migration.js <admin-secret>');
  console.error('Find it: Nhost Dashboard → Settings → Secrets → HASURA_GRAPHQL_ADMIN_SECRET → ⋮ Edit');
  process.exit(1);
}

async function runSQL(sql, label) {
  const res = await fetch(`${HASURA_URL}/v2/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': ADMIN_SECRET,
    },
    body: JSON.stringify({
      type: 'run_sql',
      args: { source: 'default', sql, cascade: false, read_only: false },
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`  ❌ ${label} failed (${res.status}):`, text.substring(0, 300));
    return false;
  }
  console.log(`  ✅ ${label}`);
  return true;
}

async function reloadMetadata() {
  const res = await fetch(`${HASURA_URL}/v1/metadata`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': ADMIN_SECRET,
    },
    body: JSON.stringify({ type: 'reload_metadata', args: { reload_remote_schemas: true } }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error('  ❌ Metadata reload failed:', text.substring(0, 200));
    return false;
  }
  console.log('  ✅ Metadata reloaded');
  return true;
}

async function main() {
  console.log('🔗 Connecting to:', HASURA_URL);
  console.log('');

  // ── Migration 4: make workflow_triggers.created_by nullable ──
  console.log('Running migration 4: fix workflow_triggers.created_by...');
  const sql4 = fs.readFileSync(
    path.join(__dirname, 'nhost', 'migrations', 'default', '4_fix_trigger_created_by', 'up.sql'),
    'utf8'
  );
  await runSQL(sql4, 'migration 4 — created_by nullable');

  // ── Reload Hasura metadata ──
  console.log('');
  console.log('Reloading Hasura metadata...');
  await reloadMetadata();

  console.log('');
  console.log('🎉 Done! Your Hasura instance is up to date.');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
