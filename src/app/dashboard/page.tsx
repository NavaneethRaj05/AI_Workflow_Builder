/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
'use client';

import { useQuery, useMutation, useSubscription } from '@apollo/client';
import { useOrgStore } from '@/lib/store';
import { GET_ORG_WORKFLOWS, GET_MY_ORGS, CREATE_ORGANIZATION, SUBSCRIBE_ORG_NOTIFICATIONS } from '@/lib/graphql/operations';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';

const STEP_TYPE_META: Record<string, { icon: string; color: string; label: string }> = {
  llm_call:           { icon: '🤖', color: '#8b5cf6', label: 'LLM Call' },
  http_request:       { icon: '🌐', color: '#06b6d4', label: 'HTTP' },
  db_write:           { icon: '💾', color: '#10b981', label: 'DB Write' },
  notify:             { icon: '🔔', color: '#f59e0b', label: 'Notify' },
  conditional_branch: { icon: '🔀', color: '#f97316', label: 'Branch' },
  approval_gate:      { icon: '🔐', color: '#ec4899', label: 'Approval' },
};

const STATUS_META: Record<string, { color: string; bg: string; dot: string }> = {
  completed: { color: '#34d399', bg: 'rgba(16,185,129,0.12)', dot: '#34d399' },
  running:   { color: '#60a5fa', bg: 'rgba(59,130,246,0.12)', dot: '#60a5fa' },
  paused:    { color: '#fbbf24', bg: 'rgba(245,158,11,0.12)', dot: '#fbbf24' },
  failed:    { color: '#f87171', bg: 'rgba(239,68,68,0.12)', dot: '#f87171' },
  pending:   { color: '#94a3b8', bg: 'rgba(148,163,184,0.08)', dot: '#64748b' },
  cancelled: { color: '#64748b', bg: 'rgba(100,116,139,0.08)', dot: '#475569' },
};

function AnimatedCounter({ value, color }: { value: number; color: string }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    if (value === 0) { setDisplay(0); return; }
    let start = 0;
    const step = Math.ceil(value / 20);
    const timer = setInterval(() => {
      start += step;
      if (start >= value) { setDisplay(value); clearInterval(timer); }
      else setDisplay(start);
    }, 40);
    return () => clearInterval(timer);
  }, [value]);
  return <span style={{ color }}>{display}</span>;
}

function TriggerIcon({ type }: { type: string }) {
  const icons: Record<string, string> = {
    manual: '👆', webhook: '🔗', scheduled: '⏰', database_event: '🗄'
  };
  return <>{icons[type] || '⚡'}</>;
}

function StepPipeline({ steps }: { steps: any[] }) {
  if (!steps?.length) return null;
  const shown = steps.slice(0, 5);
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {shown.map((s, i) => {
        const meta = STEP_TYPE_META[s.step_type] || { icon: '•', color: '#6366f1', label: s.step_type };
        return (
          <div key={s.id} className="flex items-center gap-1">
            <div title={`${meta.label}: ${s.name}`}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs"
              style={{ background: `${meta.color}18`, border: `1px solid ${meta.color}35`, color: meta.color }}>
              <span style={{ fontSize: '0.7rem' }}>{meta.icon}</span>
            </div>
            {i < shown.length - 1 && (
              <svg className="w-2.5 h-2.5" style={{ color: 'var(--border-default)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            )}
          </div>
        );
      })}
      {steps.length > 5 && (
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>+{steps.length - 5} more</span>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const { selectedOrgId, selectedOrgRole, setSelectedOrg } = useOrgStore();
  const router = useRouter();
  const [newOrgName, setNewOrgName] = useState('');
  const [creatingOrg, setCreatingOrg] = useState(false);
  const isEditor = ['owner', 'editor'].includes(selectedOrgRole || '');

  const { data: orgsData, refetch: refetchOrgs } = useQuery(GET_MY_ORGS);
  const { data: workflowsData, loading } = useQuery(GET_ORG_WORKFLOWS, {
    variables: { org_id: selectedOrgId },
    skip: !selectedOrgId,
    pollInterval: 30000,
  });
  const { data: notifData } = useSubscription(SUBSCRIBE_ORG_NOTIFICATIONS, {
    variables: { org_id: selectedOrgId, limit: 5 },
    skip: !selectedOrgId,
  });

  const [createOrg] = useMutation(CREATE_ORGANIZATION, {
    onCompleted: (d) => {
      const org = d?.insert_organizations_one;
      toast.success(`Organization "${org.name}" created!`);
      setNewOrgName('');
      setCreatingOrg(false);
      refetchOrgs().then(({ data }) => {
        if (data?.org_members?.length > 0) {
          const newMember = data.org_members.find((m: any) => m.organization.id === org.id) || data.org_members[0];
          setSelectedOrg(newMember.organization.id, newMember.role);
        }
      });
    },
    onError: (e) => { toast.error(e.message); setCreatingOrg(false); },
  });

  const handleCreateFirstOrg = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrgName.trim()) return;
    setCreatingOrg(true);
    const slug = newOrgName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    createOrg({ variables: { name: newOrgName.trim(), slug } });
  };

  const orgs = orgsData?.org_members || [];
  const currentMember = orgs.find((m: any) => m.organization.id === selectedOrgId);
  const org = currentMember?.organization;
  const workflows = workflowsData?.workflows || [];
  const notifications = notifData?.notifications || [];

  const recentRuns = workflows
    .flatMap((w: any) => w.workflow_runs?.map((r: any) => ({ ...r, workflow: w })) || [])
    .sort((a: any, b: any) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
    .slice(0, 6);

  const stats = {
    total: workflows.length,
    active: workflows.filter((w: any) => w.is_active).length,
    runningNow: recentRuns.filter((r: any) => r.status === 'running').length,
    pausedNow: recentRuns.filter((r: any) => r.status === 'paused').length,
    completedTotal: recentRuns.filter((r: any) => r.status === 'completed').length,
    failedTotal: recentRuns.filter((r: any) => r.status === 'failed').length,
  };

  const quotaPct = org ? Math.min(100, Math.round((org.quota_used / org.quota_limit) * 100)) : 0;

  // Trigger type breakdown
  const triggerCounts: Record<string, number> = {};
  workflows.forEach((w: any) => {
    const t = w.workflow_triggers?.[0]?.trigger_type || 'manual';
    triggerCounts[t] = (triggerCounts[t] || 0) + 1;
  });

  if (!selectedOrgId) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="card max-w-md w-full p-8 text-center animate-fade-in mx-4">
          <div className="mx-auto w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
            style={{ background: 'linear-gradient(135deg, #4f46e5, #818cf8)' }}>
            <span style={{ fontSize: '2rem' }}>🏢</span>
          </div>
          <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            Welcome to FlowForge
          </h2>
          <p className="mb-8 text-sm" style={{ color: 'var(--text-muted)' }}>
            Create your first organization to start building AI workflows.
          </p>
          <form onSubmit={handleCreateFirstOrg} className="flex flex-col gap-4 text-left">
            <div>
              <label className="input-label">Organization Name</label>
              <input type="text" className="input" placeholder="e.g. Acme Corp"
                value={newOrgName} onChange={e => setNewOrgName(e.target.value)}
                required disabled={creatingOrg} />
            </div>
            <button type="submit" className="btn btn-primary w-full justify-center" disabled={creatingOrg}>
              {creatingOrg ? 'Creating...' : 'Create Organization'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 animate-fade-in" style={{ maxWidth: '1400px' }}>
      {/* Header */}
      <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base font-bold"
              style={{ background: 'linear-gradient(135deg, #4f46e5, #818cf8)', color: 'white' }}>
              {org?.name?.[0]?.toUpperCase() || 'A'}
            </div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {org?.name || 'Organization'} Overview
            </h1>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            <span className="capitalize">{currentMember?.role}</span>
            {' · '}
            {workflows.length} workflow{workflows.length !== 1 ? 's' : ''}
            {' · '}
            <span style={{ color: '#60a5fa' }}>
              ● Live
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isEditor && (
            <Link href="/dashboard/workflows/new" className="btn btn-primary" id="new-workflow-btn">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Workflow
            </Link>
          )}
          <Link href="/dashboard/workflows" className="btn btn-secondary">
            View All →
          </Link>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Workflows', value: stats.total, icon: '⚡', color: '#818cf8', sub: `${stats.active} active` },
          { label: 'Completed Runs', value: stats.completedTotal, icon: '✅', color: '#34d399', sub: 'this session' },
          { label: 'Running Now', value: stats.runningNow, icon: '🔄', color: '#60a5fa', sub: stats.runningNow > 0 ? 'live' : 'idle' },
          { label: 'Awaiting Approval', value: stats.pausedNow, icon: '🔐', color: '#f472b6', sub: 'paused at gate' },
        ].map(({ label, value, icon, color, sub }) => (
          <div key={label} className="card relative overflow-hidden">
            {/* Glow accent */}
            <div className="absolute top-0 right-0 w-16 h-16 opacity-10 rounded-full blur-xl"
              style={{ background: color, transform: 'translate(30%, -30%)' }} />
            <div className="flex items-start justify-between mb-3">
              <div className="text-2xl">{icon}</div>
              {value > 0 && label === 'Running Now' && (
                <div className="step-running-indicator" style={{ background: color }} />
              )}
            </div>
            <div className="text-3xl font-bold mb-1">
              <AnimatedCounter value={value} color={color} />
            </div>
            <div className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Quota + Trigger breakdown row */}
      <div className="grid lg:grid-cols-3 gap-4 mb-6">
        {/* Quota card */}
        {org && (
          <div className="card lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Monthly Quota</h3>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  Resets {formatDistanceToNow(new Date(org.quota_reset_at), { addSuffix: true })}
                </p>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold" style={{ color: quotaPct > 90 ? '#f87171' : quotaPct > 70 ? '#fbbf24' : 'var(--text-primary)' }}>
                  {org.quota_used}<span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '1rem' }}>/{org.quota_limit}</span>
                </div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>runs used · {org.quota_limit - org.quota_used} remaining</div>
              </div>
            </div>
            <div className="quota-bar mb-2">
              <div
                className={`quota-bar-fill ${quotaPct > 90 ? 'danger' : quotaPct > 70 ? 'warning' : ''}`}
                style={{ width: `${quotaPct}%`, transition: 'width 1s ease' }}
              />
            </div>
            <div className="flex justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
              <span>0</span>
              <span style={{ color: quotaPct > 70 ? '#fbbf24' : 'var(--text-muted)' }}>{quotaPct}% used</span>
              <span>{org.quota_limit}</span>
            </div>
            {org.quota_used >= org.quota_limit && (
              <div className="mt-3 text-sm text-center p-2 rounded-lg"
                style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}>
                ⚠ Quota exhausted — new runs are blocked until reset
              </div>
            )}
          </div>
        )}

        {/* Trigger breakdown */}
        <div className="card">
          <h3 className="font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Trigger Types</h3>
          {Object.keys(triggerCounts).length === 0 ? (
            <div className="text-center py-4" style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              No workflows yet
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {Object.entries(triggerCounts).map(([type, count]) => {
                const pct = workflows.length > 0 ? Math.round((count / workflows.length) * 100) : 0;
                const colors: Record<string, string> = { manual: '#818cf8', webhook: '#06b6d4', scheduled: '#f59e0b', database_event: '#10b981' };
                const color = colors[type] || '#6366f1';
                return (
                  <div key={type}>
                    <div className="flex justify-between text-xs mb-1">
                      <span style={{ color: 'var(--text-secondary)' }}>
                        <TriggerIcon type={type} /> {type.replace(/_/g, ' ')}
                      </span>
                      <span style={{ color }}>{count}</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-overlay)' }}>
                      <div className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${pct}%`, background: color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Main content grid */}
      <div className="grid lg:grid-cols-5 gap-6">
        {/* Workflows — takes 3 cols */}
        <div className="lg:col-span-3">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Workflows</h2>
            <Link href="/dashboard/workflows" className="text-sm" style={{ color: 'var(--color-brand-400)' }}>
              View all →
            </Link>
          </div>
          {loading ? (
            <div className="flex flex-col gap-3">
              {[1, 2, 3].map(i => <div key={i} className="skeleton h-24 rounded-xl" />)}
            </div>
          ) : workflows.length === 0 ? (
            <div className="card text-center py-12">
              <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🔧</div>
              <p className="font-medium mb-2" style={{ color: 'var(--text-primary)' }}>No workflows yet</p>
              <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>Create your first AI workflow</p>
              {isEditor && (
                <Link href="/dashboard/workflows/new" className="btn btn-primary btn-sm">
                  Create Workflow
                </Link>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {workflows.slice(0, 5).map((workflow: any) => {
                const latestRun = workflow.workflow_runs?.[0];
                const statusConf = latestRun ? STATUS_META[latestRun.status] || STATUS_META.pending : null;
                const triggerType = workflow.workflow_triggers?.[0]?.trigger_type || 'manual';
                return (
                  <Link key={workflow.id} href={`/dashboard/workflows/${workflow.id}`}
                    className="card flex items-center justify-between gap-4 p-4 group cursor-pointer"
                    style={{ textDecoration: 'none' }}>
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {/* Status indicator */}
                      <div className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ background: statusConf?.dot || 'var(--border-default)' }} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                            {workflow.name}
                          </span>
                          <span className="text-xs px-1.5 py-0.5 rounded"
                            style={{ background: 'var(--bg-overlay)', color: 'var(--text-muted)' }}>
                            <TriggerIcon type={triggerType} /> {triggerType.replace(/_/g, ' ')}
                          </span>
                        </div>
                        <StepPipeline steps={workflow.workflow_steps} />
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {latestRun && statusConf && (
                        <span className="badge text-xs" style={{ background: statusConf.bg, color: statusConf.color }}>
                          {latestRun.status === 'running' && <span className="step-running-indicator mr-1" style={{ width: '5px', height: '5px', background: statusConf.color }} />}
                          {latestRun.status}
                        </span>
                      )}
                      <svg className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ color: 'var(--text-muted)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </Link>
                );
              })}
              {workflows.length > 5 && (
                <Link href="/dashboard/workflows" className="text-center text-sm py-2 rounded-xl transition-colors"
                  style={{ color: 'var(--color-brand-400)', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                  + {workflows.length - 5} more workflows
                </Link>
              )}
            </div>
          )}
        </div>

        {/* Right column — 2 cols */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* Recent Runs */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Recent Runs</h2>
              <Link href="/dashboard/runs" className="text-sm" style={{ color: 'var(--color-brand-400)' }}>
                View all →
              </Link>
            </div>
            {recentRuns.length === 0 ? (
              <div className="card text-center py-8">
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🚀</div>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No runs yet — trigger a workflow!</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {recentRuns.map((run: any) => {
                  const meta = STATUS_META[run.status] || STATUS_META.pending;
                  return (
                    <Link key={run.id} href={`/dashboard/runs/${run.id}`}
                      className="card p-3 flex items-center gap-3 cursor-pointer"
                      style={{ textDecoration: 'none' }}>
                      <div className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ background: meta.dot }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                          {run.workflow?.name}
                        </div>
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          <TriggerIcon type={run.trigger_type} /> {formatDistanceToNow(new Date(run.started_at), { addSuffix: true })}
                        </div>
                      </div>
                      <span className="badge text-xs flex-shrink-0" style={{ background: meta.bg, color: meta.color }}>
                        {run.status === 'running' && <span className="step-running-indicator mr-1" style={{ width: '4px', height: '4px', background: meta.color }} />}
                        {run.status}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Live Notifications */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                Notifications
                <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#60a5fa' }} />
              </h2>
              <Link href="/dashboard/notifications" className="text-sm" style={{ color: 'var(--color-brand-400)' }}>
                View all →
              </Link>
            </div>
            {notifications.length === 0 ? (
              <div className="card text-center py-6">
                <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>🔔</div>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Notifications from <code>notify</code> steps appear here live
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {notifications.map((n: any) => {
                  const chColors: Record<string, string> = { slack: '#818cf8', email: '#34d399', system: '#94a3b8' };
                  const color = chColors[n.channel] || '#94a3b8';
                  return (
                    <div key={n.id} className="card p-3 flex items-start gap-2.5">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-sm"
                        style={{ background: `${color}18` }}>
                        {n.channel === 'slack' ? '💬' : n.channel === 'email' ? '📧' : '🔔'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                          {n.title}
                        </div>
                        <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                          {formatDistanceToNow(new Date(n.sent_at), { addSuffix: true })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Quick Actions */}
          <div className="card">
            <h3 className="font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Quick Actions</h3>
            <div className="flex flex-col gap-2">
              {isEditor && (
                <Link href="/dashboard/workflows/new" className="btn btn-secondary w-full justify-start gap-2" id="qa-new-workflow">
                  <span>⚡</span> New Workflow
                </Link>
              )}
              <Link href="/dashboard/runs" className="btn btn-secondary w-full justify-start gap-2" id="qa-run-history">
                <span>🕐</span> Run History
              </Link>
              <Link href="/dashboard/notifications" className="btn btn-secondary w-full justify-start gap-2" id="qa-notifications">
                <span>🔔</span> Notifications
              </Link>
              {selectedOrgRole === 'owner' && (
                <Link href="/dashboard/admin" className="btn btn-secondary w-full justify-start gap-2" id="qa-team">
                  <span>👥</span> Manage Team
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
