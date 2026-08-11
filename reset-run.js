const HASURA = 'https://bykigbyxcjykjxbhakqc.hasura.ap-south-1.nhost.run';
const SECRET = 'FlowForge2024!';
const RUN_ID = '0312eabf-0637-48ec-89fd-588844b6b722';
const now = new Date().toISOString();

async function gql(query) {
  const r = await fetch(HASURA + '/v1/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-hasura-admin-secret': SECRET },
    body: JSON.stringify({ query }),
  });
  return r.json();
}

async function main() {
  const d1 = await gql(`mutation { update_step_runs(where: {workflow_run_id: {_eq: "${RUN_ID}"}, status: {_eq: "running"}}, _set: {status: "failed", error: "Reset stale run", completed_at: "${now}"}) { affected_rows } }`);
  console.log('step_runs reset:', JSON.stringify(d1?.data ?? d1?.errors));

  const d2 = await gql(`mutation { update_workflow_runs(where: {id: {_eq: "${RUN_ID}"}}, _set: {status: "failed", completed_at: "${now}"}) { affected_rows } }`);
  console.log('workflow_run reset:', JSON.stringify(d2?.data ?? d2?.errors));
}

main().catch(console.error);
