/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
'use client';

import { useQuery, useMutation } from '@apollo/client';
import { useOrgStore } from '@/lib/store';
import { GET_ORG_WORKFLOWS, GET_MY_ORGS, CREATE_ORGANIZATION } from '@/lib/graphql/operations';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import toast from 'react-hot-toast';

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
    onError: (e) => {
      toast.error(e.message);
      setCreatingOrg(false);
    },
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
            To start building workflows, you need an organization to house them.
            Create your first organization below.
          </p>
          <form onSubmit={handleCreateFirstOrg} className="flex flex-col gap-4 text-left">
            <div>
              <label className="input-label">Organization Name</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. Acme Corp"
                value={newOrgName}
                onChange={e => setNewOrgName(e.target.value)}
                required
                disabled={creatingOrg}
              />
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
