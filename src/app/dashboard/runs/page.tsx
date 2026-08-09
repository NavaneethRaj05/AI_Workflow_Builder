'use client';

import { useQuery } from '@apollo/client';
import { useOrgStore } from '@/lib/store';
import { GET_ORG_WORKFLOWS } from '@/lib/graphql/operations';
import Link from 'next/link';
import { formatDistanceToNow, format } from 'date-fns';

const STATUS_CONFIG: Record<string, { color: string; icon: string }> = {
  pending: { color: '#64748b', icon: '⏳' },
  running: { color: '#60a5fa', icon: '🔄' },
  completed: { color: '#34d399', icon: '✅' },
  failed: { color: '#f87171', icon: '❌' },
  paused: { color: '#fbbf24', icon: '⏸' },
  cancelled: { color: '#94a3b8', icon: '⏹' },
};

export default function RunsPage() {
  const { selectedOrgId } = useOrgStore();

  const { data, loading } = useQuery(GET_ORG_WORKFLOWS, {
    variables: { org_id: selectedOrgId },
    skip: !selectedOrgId,
  });

  const workflows = data?.workflows || [];
  const allRuns = workflows
    .flatMap((w: any) =>
      (w.workflow_runs || []).map((r: any) => ({ ...r, workflow: w }))
    )
    .sort((a: any, b: any) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());

  return (
    <div className="p-8 animate-fade-in">
      <div className="mb-8">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Run History</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          {allRuns.length} run{allRuns.length !== 1 ? 's' : ''} across all workflows
        </p>
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3, 4, 5].map(i => <div key={i} className="skeleton h-16 rounded-xl" />)}
        </div>
      ) : allRuns.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div style={{ fontSize: '4rem' }}>🚀</div>
          <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>No runs yet</h2>
          <p style={{ color: 'var(--text-muted)' }}>Trigger a workflow to see execution history here</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {allRuns.map((run: any) => {
            const statusConf = STATUS_CONFIG[run.status] || STATUS_CONFIG.pending;
            const duration = run.completed_at
              ? Math.round((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000)
              : null;

            return (
              <Link
                key={run.id}
                href={`/dashboard/runs/${run.id}`}
                className="card flex items-center gap-4 p-4 cursor-pointer"
                style={{ textDecoration: 'none' }}
              >
                <div className="text-xl">{statusConf.icon}</div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                      {run.workflow?.name}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full"
                      style={{ background: 'var(--bg-overlay)', color: 'var(--text-muted)' }}>
                      {run.trigger_type}
                    </span>
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {format(new Date(run.started_at), 'MMM d, yyyy HH:mm')}
                    {duration !== null && ` · ${duration}s`}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className={`badge badge-${run.status}`}>
                    {run.status === 'running' && (
                      <span className="step-running-indicator" style={{ width: '5px', height: '5px' }} />
                    )}
                    {run.status}
                  </span>
                  <svg className="w-4 h-4" style={{ color: 'var(--text-muted)' }}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
                  </svg>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
