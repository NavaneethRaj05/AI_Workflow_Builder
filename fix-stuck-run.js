/**
 * Fix stuck step_runs and workflow_runs using admin secret.
 * Usage: node fix-stuck-run.js <admin-secret> [run-id]
 * 
 * If run-id is not provided, fixes ALL stuck running step_runs.
 */

const HASURA_URL = 'https://bykigbyxcjykjxbhakqc.hasura.ap-south-1.nhost.run';
const ADMIN_SECRET = process.argv[2];
const RUN_ID = process.argv[3] || null;

if (!ADMIN_SECRET) {
  console.error('Usage: node fix-stuck-run.js <admin-secret> [run-id]');
  process.exit(1);
}

async function gql(query, variables = {}) {
  const res = await fetch(`${HASURA_URL}/v1/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': ADMIN_SECRET,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data;
}

async function runSQL(sql) {
  const res = await fetch(`${HASURA_URL}/v2/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': ADMIN_SECRET,
    },
    body: JSON.stringify({ type: 'run_sql', args: { source: 'default', sql, read_only: false } }),
  });
  return res.json();
}

async function main() {
  console.log('Testing connection...');
  
  // Test auth first
  const test = await runSQL('SELECT 1 as test');
  if (test.error) {
    console.error('❌ Auth failed:', test.error);
    return;
  }
  console.log('✅ Connected!\n');

  // Fix stuck step_runs
  const whereClause = RUN_ID
    ? `where: { workflow_run_id: { _eq: "${RUN_ID}" }, status: { _eq: "running" } }`
    : `where: { status: { _eq: "running" } }`;

  const result = await gql(`
    mutation FixStuckSteps {
      update_step_runs(
        ${whereClause}
        _set: {
          status: "failed"
          error: "Manually reset — stuck in running state"
          completed_at: "${new Date().toISOString()}"
        }
      ) { affected_rows }
    }
  `);
  console.log(`✅ Fixed ${result.update_step_runs.affected_rows} stuck step_run(s)`);

  // Fix stuck workflow_runs
  const runWhereClause = RUN_ID
    ? `where: { id: { _eq: "${RUN_ID}" }, status: { _in: ["running", "pending"] } }`
    : `where: { status: { _in: ["running", "pending"] } }`;

  const runResult = await gql(`
    mutation FixStuckRuns {
      update_workflow_runs(
        ${runWhereClause}
        _set: {
          status: "failed"
          completed_at: "${new Date().toISOString()}"
          error: "Manually reset — stuck in running state"
        }
      ) { affected_rows }
    }
  `);
  console.log(`✅ Fixed ${runResult.update_workflow_runs.affected_rows} stuck workflow_run(s)`);
  console.log('\nDone! Re-trigger your workflow from the UI.');
}

main().catch(err => {
  console.error('Error:', err.message);
});
