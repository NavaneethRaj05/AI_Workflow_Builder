/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
'use client';

import { useQuery } from '@apollo/client';
import { useOrgStore } from '@/lib/store';
import { GET_ORG_WORKFLOWS, GET_MY_ORGS } from '@/lib/graphql/operations';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { useRouter } from 'next/navigation';

export default function DashboardPage() {
  const { selectedOrgId, selectedOrgRole } = useOrgStore();
  const router = useRouter();
  const isEditor = ['owner', 'editor'].includes(selectedOrgRole || '');

  const { data: orgsData } = useQuery(GET_MY_ORGS);
  const { data: workflowsData, loading } = useQuery(GET_ORG_WORKFLOWS, {
    variables: { org_id: selectedOrgId },
    skip: !selectedOrgId,
  });

  const orgs = orgsData?.org_members || [];
  const currentMember = orgs.find((m: any) => m.organization.id === selectedOrgId);
  const org = currentMember?.organization;
  const workflows = workflowsData?.workflows || [];

  const recentRuns = workflows
    .flatMap((w: any) => w.workflow_runs?.map((r: any) => ({ ...r, workflow: w })) || [])
    .sort((a: any, b: any) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
    .slice(0, 5);

  const stats = {
    total: workflows.length,
    active: workflows.filter((w: any) => w.is_active).length,
    runningNow: workflows.filter((w: any) =>
      w.workflow_runs?.[0]?.status === 'running'
    ).length,
    pausedNow: workflows.filter((w: any) =>
      w.workflow_runs?.[0]?.status === 'paused'
    ).length,
  };

  if (!selectedOrgId) {
    return (
      <div className="flex items-center justify-center h-full flex-col gap-4">
        <div style={{ fontSize: '3rem' }}>🏢</div>
        <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>No Organization Selected</h2>
        <p style={{ color: 'var(--text-muted)' }}>Select or create an organization to get started.</p>
      </div>
    );
  }

  return (
    <div className="p-8 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
            {org?.name || 'Organization'} Overview
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            {currentMember?.role} · {workflows.length} workflow{workflows.length !== 1 ? 's' : ''}
          </p>
        </div>
        {isEditor && (
          <Link href="/dashboard/workflows/new" className="btn btn-primary">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>
            </svg>
            New Workflow
          </Link>
        )}
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Workflows', value: stats.total, icon: '⚡', color: '#818cf8' },
          { label: 'Active', value: stats.active, icon: '✅', color: '#34d399' },
          { label: 'Running Now', value: stats.runningNow, icon: '🔄', color: '#60a5fa' },
          { label: 'Awaiting Approval', value: stats.pausedNow, icon: '⏸', color: '#fbbf24' },
        ].map(({ label, value, icon, color }) => (
          <div key={label} className="card" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>{icon}</div>
            <div className="text-3xl font-bold mb-1" style={{ color }}>{value}</div>
            <div className="text-sm" style={{ color: 'var(--text-muted)' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Quota card */}
      {org && (
        <div className="card mb-8">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Monthly Quota</h3>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Resets {formatDistanceToNow(new Date(org.quota_reset_at), { addSuffix: true })}
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                {org.quota_used}<span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>/{org.quota_limit}</span>
              </div>
              <div className="text-sm" style={{ color: 'var(--text-muted)' }}>runs used</div>
            </div>
          </div>
          <div className="quota-bar">
            <div
              className={`quota-bar-fill ${
                org.quota_used / org.quota_limit > 0.9 ? 'danger'
                : org.quota_used / org.quota_limit > 0.7 ? 'warning' : ''
              }`}
              style={{ width: `${Math.min(100, (org.quota_used / org.quota_limit) * 100)}%` }}
            />
          </div>
          {org.quota_used >= org.quota_limit && (
            <div className="mt-3 text-sm text-center p-2 rounded-lg"
              style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}>
              ⚠ Quota exhausted — runs are blocked until reset
            </div>
          )}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Workflows list */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Workflows</h2>
            <Link href="/dashboard/workflows" className="text-sm" style={{ color: 'var(--color-brand-400)' }}>
              View all →
            </Link>
          </div>
          {loading ? (
            <div className="flex flex-col gap-3">
              {[1, 2, 3].map(i => <div key={i} className="skeleton h-16 rounded-xl" />)}
            </div>
          ) : workflows.length === 0 ? (
            <div className="card text-center py-10">
              <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🔧</div>
              <p className="font-medium mb-2" style={{ color: 'var(--text-primary)' }}>No workflows yet</p>
              <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                Create your first AI workflow to get started
              </p>
              {isEditor && (
                <Link href="/dashboard/workflows/new" className="btn btn-primary btn-sm">
                  Create Workflow
                </Link>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {workflows.slice(0, 6).map((workflow: any) => {
                const latestRun = workflow.workflow_runs?.[0];
                return (
                  <Link
                    key={workflow.id}
                    href={`/dashboard/workflows/${workflow.id}`}
                    className="card flex items-center justify-between group cursor-pointer p-4 hover:border-opacity-100"
                    style={{ textDecoration: 'none' }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center text-sm flex-shrink-0"
                        style={{ background: 'var(--bg-overlay)', color: 'var(--color-brand-400)' }}>
                        ⚡
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate" style={{ color: 'var(--text-primary)' }}>
                          {workflow.name}
                        </div>
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {workflow.workflow_steps?.length || 0} steps ·{' '}
                          {workflow.workflow_triggers?.[0]?.trigger_type || 'manual'}
                        </div>
                      </div>
                    </div>
                    {latestRun && (
                      <span className={`badge badge-${latestRun.status} flex-shrink-0`}>
                        {latestRun.status}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent runs */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Recent Runs</h2>
            <Link href="/dashboard/runs" className="text-sm" style={{ color: 'var(--color-brand-400)' }}>
              View all →
            </Link>
          </div>
          {recentRuns.length === 0 ? (
            <div className="card text-center py-10">
              <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🚀</div>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No runs yet</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {recentRuns.map((run: any) => (
                <Link
                  key={run.id}
                  href={`/dashboard/runs/${run.id}`}
                  className="card p-4 flex items-center gap-3 cursor-pointer"
                  style={{ textDecoration: 'none' }}
                >
                  <div className={`w-2 h-2 rounded-full flex-shrink-0`}
                    style={{
                      background:
                        run.status === 'completed' ? 'var(--status-succeeded)'
                        : run.status === 'running' ? 'var(--status-running)'
                        : run.status === 'failed' ? 'var(--status-failed)'
                        : run.status === 'paused' ? 'var(--status-paused)'
                        : 'var(--status-pending)',
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                      {run.workflow?.name}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {run.trigger_type} · {formatDistanceToNow(new Date(run.started_at), { addSuffix: true })}
                    </div>
                  </div>
                  <span className={`badge badge-${run.status}`}>{run.status}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
