'use client';

import { useQuery } from '@apollo/client';
import { useOrgStore } from '@/lib/store';
import { GET_ORG_WORKFLOWS, TRIGGER_WORKFLOW_RUN } from '@/lib/graphql/operations';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { useMutation } from '@apollo/client';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';

const STEP_TYPE_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  llm_call: { label: 'LLM Call', color: '#8b5cf6', icon: '🤖' },
  http_request: { label: 'HTTP Request', color: '#06b6d4', icon: '🌐' },
  db_write: { label: 'DB Write', color: '#10b981', icon: '💾' },
  notify: { label: 'Notify', color: '#f59e0b', icon: '🔔' },
  conditional_branch: { label: 'Branch', color: '#f97316', icon: '🔀' },
  approval_gate: { label: 'Approval Gate', color: '#ec4899', icon: '🔐' },
};

export default function WorkflowsPage() {
  const { selectedOrgId, selectedOrgRole } = useOrgStore();
  const router = useRouter();
  const isEditor = ['owner', 'editor'].includes(selectedOrgRole || '');

  const { data, loading, refetch } = useQuery(GET_ORG_WORKFLOWS, {
    variables: { org_id: selectedOrgId },
    skip: !selectedOrgId,
  });

  const [triggerRun] = useMutation(TRIGGER_WORKFLOW_RUN, {
    onCompleted: (data) => {
      const runId = data?.triggerWorkflowRun?.run_id;
      if (runId) {
        toast.success('Workflow started!');
        router.push(`/dashboard/runs/${runId}`);
      }
    },
    onError: (error) => toast.error(error.message),
  });

  const workflows = data?.workflows || [];

  return (
    <div className="p-8 animate-fade-in">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Workflows</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            {workflows.length} workflow{workflows.length !== 1 ? 's' : ''} in this organization
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

      {loading ? (
        <div className="workflow-grid">
          {[1, 2, 3, 4].map(i => <div key={i} className="skeleton h-48 rounded-2xl"/>)}
        </div>
      ) : workflows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div style={{ fontSize: '4rem' }}>🔧</div>
          <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>No workflows yet</h2>
          <p style={{ color: 'var(--text-muted)' }}>Build your first AI agent workflow</p>
          {isEditor && (
            <Link href="/dashboard/workflows/new" className="btn btn-primary mt-2">Create Workflow</Link>
          )}
        </div>
      ) : (
        <div className="workflow-grid">
          {workflows.map((workflow: any) => {
            const latestRun = workflow.workflow_runs?.[0];
            const steps = workflow.workflow_steps || [];
            const trigger = workflow.workflow_triggers?.[0];

            return (
              <div key={workflow.id} className="card flex flex-col gap-4 group"
                style={{ borderColor: 'var(--border-subtle)', cursor: 'default' }}>
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg"
                      style={{
                        background: 'linear-gradient(135deg, rgba(99,102,241,0.2), rgba(192,132,252,0.2))',
                        border: '1px solid rgba(99,102,241,0.2)',
                      }}>
                      ⚡
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                        {workflow.name}
                      </h3>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {steps.length} step{steps.length !== 1 ? 's' : ''} · {trigger?.trigger_type || 'manual'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {workflow.is_active ? (
                      <span className="badge badge-succeeded" style={{ fontSize: '0.65rem' }}>active</span>
                    ) : (
                      <span className="badge badge-pending" style={{ fontSize: '0.65rem' }}>inactive</span>
                    )}
                  </div>
                </div>

                {/* Step pills */}
                {steps.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {steps.slice(0, 5).map((step: any) => {
                      const conf = STEP_TYPE_CONFIG[step.step_type] || { label: step.step_type, color: '#6366f1', icon: '•' };
                      return (
                        <span key={step.id}
                          className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                          style={{
                            background: `${conf.color}20`,
                            color: conf.color,
                            border: `1px solid ${conf.color}40`,
                          }}>
                          <span>{conf.icon}</span>
                          {conf.label}
                        </span>
                      );
                    })}
                    {steps.length > 5 && (
                      <span className="text-xs px-2 py-0.5 rounded-full"
                        style={{ background: 'var(--bg-overlay)', color: 'var(--text-muted)' }}>
                        +{steps.length - 5} more
                      </span>
                    )}
                  </div>
                )}

                {/* Latest run */}
                {latestRun && (
                  <div className="flex items-center justify-between text-xs py-2 border-t"
                    style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}>
                    <span>Last run {formatDistanceToNow(new Date(latestRun.started_at), { addSuffix: true })}</span>
                    <Link href={`/dashboard/runs/${latestRun.id}`}>
                      <span className={`badge badge-${latestRun.status}`}>{latestRun.status}</span>
                    </Link>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2">
                  <Link href={`/dashboard/workflows/${workflow.id}`}
                    className="btn btn-secondary btn-sm flex-1" style={{ textDecoration: 'none' }}>
                    {isEditor ? 'Edit' : 'View'}
                  </Link>
                  {isEditor && (
                    <button
                      className="btn btn-primary btn-sm flex-1"
                      onClick={() => triggerRun({ variables: { workflow_id: workflow.id } })}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                      </svg>
                      Run
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
