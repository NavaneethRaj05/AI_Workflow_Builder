/**
 * Apply Hasura metadata via the metadata API
 * 
 * Run with: node apply-metadata.js <hasura-url> <admin-secret>
 * 
 * The Hasura URL is: https://<subdomain>.hasura.<region>.nhost.run
 * The admin secret can be found in Nhost Dashboard → Settings → Hasura
 */

const fs = require('fs');
const path = require('path');

const HASURA_ENDPOINT = process.argv[2] || process.env.HASURA_ENDPOINT || 'https://bykigbyxcjykjxbhakqc.hasura.ap-south-1.nhost.run';
const ADMIN_SECRET = process.argv[3] || process.env.HASURA_ADMIN_SECRET;

if (!ADMIN_SECRET) {
  console.error('ERROR: HASURA_ADMIN_SECRET is required');
  console.error('Usage: node apply-metadata.js <hasura-url> <admin-secret>');
  process.exit(1);
}

const METADATA_API = `${HASURA_ENDPOINT}/v1/metadata`;
const QUERY_API = `${HASURA_ENDPOINT}/v2/query`;

async function hasuraMetadata(body) {
  const res = await fetch(METADATA_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': ADMIN_SECRET,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`Metadata API error (${res.status}):`, text.substring(0, 200));
    return null;
  }
  try { return JSON.parse(text); } catch { return text; }
}

async function hasuraQuery(sql) {
  const res = await fetch(QUERY_API, {
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
    console.error(`SQL error (${res.status}):`, text.substring(0, 300));
    return null;
  }
  try { return JSON.parse(text); } catch { return text; }
}

async function main() {
  console.log('Applying metadata to:', HASURA_ENDPOINT);

  // Step 1: Run migrations
  console.log('\nStep 1: Applying SQL migrations...');
  const migrationDirs = ['1_initial_schema', '2_views_functions', '3_org_creation_trigger'];
  for (const dir of migrationDirs) {
    const sqlPath = path.join(__dirname, 'nhost', 'migrations', 'default', dir, 'up.sql');
    if (fs.existsSync(sqlPath)) {
      const sql = fs.readFileSync(sqlPath, 'utf8');
      console.log(`  Running ${dir}...`);
      const result = await hasuraQuery(sql);
      if (result) console.log(`  OK: ${dir} applied`);
      else console.log(`  WARN: ${dir} may already exist`);
    }
  }

  // Step 2: Reload metadata
  console.log('\nStep 2: Reloading metadata...');
  await hasuraMetadata({ type: 'reload_metadata', args: {} });
  console.log('  OK: Metadata reloaded');

  console.log('\nDone!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
