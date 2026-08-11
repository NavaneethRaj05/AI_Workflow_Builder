/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@apollo/client';
import { useOrgStore } from '@/lib/store';
import {
  GET_ORG_WORKFLOWS,
  TRIGGER_WORKFLOW_RUN,
  DELETE_WORKFLOW,
  DELETE_WORKFLOW_RUNS_BY_WORKFLOW,
} from '@/lib/graphql/operations';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import nhost from '@/lib/nhost';
import toast from 'react-hot-toast';

const STEP_TYPE_ICONS: Record<string, string> = {
  llm_call: '🤖',
  http_request: '🌐',
  db_write: '💾',
  notify: '🔔',
  conditional_branch: '🔀',
  approval_gate: '🔐',
};

const STATUS_COLORS: Record<string, { color: string; bg: string }> = {
  completed: { color: '#34d399', bg: 'rgba(16,185,129,0.15)' },
  running: { color: '#60a5fa', bg: 'rgba(59,130,246,0.15)' },
  paused: { color: '#fbbf24', bg: 'rgba(245,158,11,0.15)' },
  failed: { color: '#f87171', bg: 'rgba(239,68,68,0.15)' },
  pending: { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' },
  cancelled: { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' },
};

export default function WorkflowsPage() {
  const { selectedOrgId, selectedOrgRole } = useOrgStore();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const isEditor = ['owner', 'editor'].includes(selectedOrgRole || '');

  const { data, loading, refetch } = useQuery(GET_ORG_WORKFLOWS, {
    variables: { org_id: selectedOrgId },
    skip: !selectedOrgId,
  });

  const [triggerRun] = useMutation(TRIGGER_WORKFLOW_RUN);

  const handleRunWorkflow = async (workflowId: string) => {
    // Find the org_id for this workflow
    const workflow = data?.workflows?.find((w: any) => w.id === workflowId);
    if (!workflow) {
      toast.error('Workflow not found');
      return;
    }

    // Try primary path: Hasura Action (works when auth token is valid)
    try {
      const res = await triggerRun({ variables: { workflow_id: workflowId } });
      const runId = res.data?.triggerWorkflowRun?.run_id;
      if (runId) {
        toast.success('Workflow started!');
        router.push(`/dashboard/runs/${runId}`);
        return;
      }
    } catch (err: any) {
      const msg: string = err?.graphQLErrors?.[0]?.message || err?.message || '';
      // Surface quota/permission errors directly — don't fall through
      if (msg.includes('Quota exhausted') || msg.includes('Forbidden')) {
        toast.error(msg, { duration: 6000 });
        return;
      }
      // Other errors (auth/network) — fall through to server-side route
      console.warn('[Run] Hasura Action failed, using server-side fallback:', msg);
    }

    // Fallback: server-side API route
    try {
      toast.loading('Starting workflow...', { id: 'run-toast' });
      const token = nhost.auth.getAccessToken();
      const r = await fetch('/api/run-workflow', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ workflow_id: workflowId, org_id: selectedOrgId }),
      });
      const body = await r.json();
      if (!r.ok) {
        const hint = body.error?.includes('x-hasura-admin-secret') || body.error?.includes('NHOST_ADMIN_SECRET')
          ? 'NHOST_ADMIN_SECRET in .env.local is invalid. Update it with the secret from Nhost Dashboard → Settings → Secrets.'
          : body.error || 'Failed to start workflow';
        toast.error(hint, { id: 'run-toast', duration: 7000 });
        return;
      }
      toast.success('Workflow started!', { id: 'run-toast' });
      router.push(`/dashboard/runs/${body.run_id}`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to start workflow', { id: 'run-toast' });
    }
  };

  const [deleteWorkflowRuns] = useMutation(DELETE_WORKFLOW_RUNS_BY_WORKFLOW);

  const [deleteWorkflow] = useMutation(DELETE_WORKFLOW, {
    update(cache, { data }) {
      const deletedId = data?.delete_workflows_by_pk?.id;
      if (!deletedId) return;
      cache.modify({
        fields: {
          workflows(existing: readonly any[] = [], { readField }) {
            return existing.filter(ref => readField('id', ref) !== deletedId);
          },
        },
      });
    },
    onCompleted: () => {
      toast.success('Workflow deleted');
      setDeletingId(null);
    },
    onError: (e) => {
      toast.error(e.message);
      setDeletingId(null);
    },
  });

  const handleDeleteWorkflow = async (workflowId: string, workflowName: string) => {
    if (!window.confirm(`Delete "${workflowName}"? This cannot be undone.`)) return;
    setDeletingId(workflowId);
    try {
      // Delete runs first so the last run badge disappears cleanly
      await deleteWorkflowRuns({ variables: { workflow_id: workflowId } });
    } catch {
      // Runs may already be gone or cascade — continue with workflow delete
    }
    deleteWorkflow({ variables: { id: workflowId } });
  };

  const workflows = (data?.workflows || []).filter((w: any) =>
    w.name.toLowerCase().includes(search.toLowerCase()) ||
    (w.description || '').toLowerCase().includes(search.toLowerCase())
  );

  if (!selectedOrgId) {
    return (
      <div className="flex items-center justify-center h-full flex-col gap-4">
        <div style={{ fontSize: '3rem' }}>🏢</div>
        <p style={{ color: 'var(--text-muted)' }}>Select an organization to view workflows.</p>
      </div>
    );
  }

  return (
    <div className="p-8 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
            Workflows
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            {workflows.length} workflow{workflows.length !== 1 ? 's' : ''} in this organization
          </p>
        </div>
        {isEditor && (
          <Link href="/dashboard/workflows/new" className="btn btn-primary">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Workflow
          </Link>
        )}
      </div>

      {/* Search */}
      <div className="mb-6">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
            style={{ color: 'var(--text-muted)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0" />
          </svg>
          <input
            className="input pl-9"
            placeholder="Search workflows..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            id="workflow-search"
          />
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="grid gap-4">
          {[1, 2, 3].map(i => <div key={i} className="skeleton h-32 rounded-xl" />)}
        </div>
      ) : workflows.length === 0 ? (
        <div className="card text-center py-20">
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔧</div>
          <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
            {search ? 'No workflows match your search' : 'No workflows yet'}
          </h3>
          <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
            {search ? 'Try a different search term.' : 'Create your first AI workflow to get started.'}
          </p>
          {isEditor && !search && (
            <Link href="/dashboard/workflows/new" className="btn btn-primary">
              Create your first workflow
            </Link>
          )}
        </div>
      ) : (
        <div className="grid gap-4">
          {workflows.map((workflow: any) => {
            const latestRun = workflow.workflow_runs?.[0];
            const statusConf = latestRun ? STATUS_COLORS[latestRun.status] || STATUS_COLORS.pending : null;
            const stepTypes: string[] = [...new Set<string>(workflow.workflow_steps?.map((s: any) => s.step_type) || [])];
            const isDeleting = deletingId === workflow.id;

            return (
              <div key={workflow.id} className="card" style={{ opacity: !workflow.is_active ? 0.65 : 1 }}>
                <div className="flex items-start gap-4">
                  {/* Icon */}
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.2)' }}>
                    <span style={{ fontSize: '1.25rem' }}>⚡</span>
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* Title row */}
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {workflow.name}
                      </h3>
                      {!workflow.is_active && (
                        <span className="badge" style={{ background: 'var(--bg-muted)', color: 'var(--text-muted)', fontSize: '0.625rem' }}>
                          inactive
                        </span>
                      )}
                      {latestRun && statusConf && (
                        <span className="badge" style={{ background: statusConf.bg, color: statusConf.color }}>
                          {latestRun.status}
                        </span>
                      )}
                    </div>

                    {/* Description */}
                    {workflow.description && (
                      <p className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>
                        {workflow.description}
                      </p>
                    )}

                    {/* Meta */}
                    <div className="flex items-center gap-4 text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                      <span>{workflow.workflow_steps?.length || 0} steps</span>
                      <span>
                        {workflow.workflow_triggers?.[0]?.trigger_type === 'webhook' ? '🔗 webhook'
                          : workflow.workflow_triggers?.[0]?.trigger_type === 'scheduled' ? '⏰ scheduled'
                          : workflow.workflow_triggers?.[0]?.trigger_type === 'database_event' ? '🗄 db event'
                          : '👆 manual'}
                      </span>
                      {latestRun && (
                        <span>Last run {formatDistanceToNow(new Date(latestRun.started_at), { addSuffix: true })}</span>
                      )}
                    </div>

                    {/* Step type pills */}
                    {stepTypes.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap mb-4">
                        {stepTypes.map((type) => (
                          <span key={type} className="text-xs px-2 py-0.5 rounded-full"
                            style={{ background: 'var(--bg-overlay)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>
                            {STEP_TYPE_ICONS[type] || '•'} {type.replace(/_/g, ' ')}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/dashboard/workflows/${workflow.id}`} className="btn btn-secondary btn-sm"
                        id={`edit-workflow-${workflow.id}`}>
                        {isEditor ? '✏ Edit' : '👁 View'}
                      </Link>

                      {isEditor && workflow.is_active && (
                        <button className="btn btn-primary btn-sm" id={`run-workflow-${workflow.id}`}
                          onClick={() => handleRunWorkflow(workflow.id)}>
                          ▶ Run Now
                        </button>
                      )}

                      {latestRun && (
                        <Link href={`/dashboard/runs/${latestRun.id}`} className="btn btn-secondary btn-sm">
                          Last Run →
                        </Link>
                      )}

                      {selectedOrgRole === 'owner' && (
                        <button
                          className="btn btn-sm ml-auto"
                          id={`delete-workflow-${workflow.id}`}
                          style={{ color: '#f87171', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}
                          disabled={isDeleting}
                          onClick={() => handleDeleteWorkflow(workflow.id, workflow.name)}
                        >
                          {isDeleting ? '...' : '🗑 Delete'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
