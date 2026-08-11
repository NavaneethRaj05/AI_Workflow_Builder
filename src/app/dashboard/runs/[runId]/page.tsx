/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useParams, useRouter } from 'next/navigation';
import { useQuery, useSubscription, useMutation } from '@apollo/client';
import {
  GET_RUN_DETAIL,
  SUBSCRIBE_STEP_RUNS,
  SUBSCRIBE_WORKFLOW_RUN,
  APPROVE_STEP,
} from '@/lib/graphql/operations';
import { useOrgStore } from '@/lib/store';
import { formatDistanceToNow, format } from 'date-fns';
import toast from 'react-hot-toast';
import { useState, useEffect } from 'react';

const STEP_TYPE_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  llm_call: { label: 'LLM Call', color: '#8b5cf6', icon: '🤖' },
  http_request: { label: 'HTTP Request', color: '#06b6d4', icon: '🌐' },
  db_write: { label: 'DB Write', color: '#10b981', icon: '💾' },
  notify: { label: 'Notify', color: '#f59e0b', icon: '🔔' },
  conditional_branch: { label: 'Branch', color: '#f97316', icon: '🔀' },
  approval_gate: { label: 'Approval Gate', color: '#ec4899', icon: '🔐' },
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string; icon: string }> = {
  pending: { label: 'Pending', color: '#64748b', bgColor: 'rgba(100,116,139,0.15)', icon: '⏳' },
  running: { label: 'Running', color: '#60a5fa', bgColor: 'rgba(59,130,246,0.15)', icon: '🔄' },
  succeeded: { label: 'Succeeded', color: '#34d399', bgColor: 'rgba(16,185,129,0.15)', icon: '✅' },
  failed: { label: 'Failed', color: '#f87171', bgColor: 'rgba(239,68,68,0.15)', icon: '❌' },
  paused: { label: 'Paused', color: '#fbbf24', bgColor: 'rgba(245,158,11,0.15)', icon: '⏸' },
  awaiting_approval: { label: 'Awaiting Approval', color: '#f472b6', bgColor: 'rgba(236,72,153,0.15)', icon: '🔐' },
  skipped: { label: 'Skipped', color: '#94a3b8', bgColor: 'rgba(148,163,184,0.1)', icon: '⏭' },
};

function StepRunCard({
  stepRun,
  canApprove,
  onApprove,
}: {
  stepRun: any;
  canApprove: boolean;
  onApprove: (stepRunId: string, comment: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [approvalComment, setApprovalComment] = useState('');
  const [showApprovalForm, setShowApprovalForm] = useState(false);

  const step = stepRun.workflow_step;
  const typeConf = STEP_TYPE_CONFIG[step?.step_type] || { label: step?.step_type, color: '#6366f1', icon: '•' };
  const statusConf = STATUS_CONFIG[stepRun.status] || STATUS_CONFIG.pending;
  const isAwaiting = stepRun.status === 'awaiting_approval';
  const isRunning = stepRun.status === 'running';

  return (
    <div className="timeline-item pb-6">
      {/* Dot */}
      <div className={`timeline-dot ${stepRun.status}`}>
        {isRunning ? (
          <div className="step-running-indicator" />
        ) : (
          <span style={{ fontSize: '0.75rem' }}>{statusConf.icon}</span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 mt-0">
        <div
          className="card p-4 cursor-pointer"
          style={{
            border: isAwaiting ? '1px solid rgba(236,72,153,0.3)' : undefined,
            background: isAwaiting ? 'rgba(236,72,153,0.05)' : undefined,
            borderLeft: `3px solid ${typeConf.color}`,
          }}
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span style={{ fontSize: '1.1rem' }}>{typeConf.icon}</span>
              <div className="min-w-0">
                <div className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                  {step?.name}
                </div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {typeConf.label}
                  {stepRun.started_at && (
                    <> · Started {formatDistanceToNow(new Date(stepRun.started_at), { addSuffix: true })}</>
                  )}
                  {stepRun.attempt_count > 1 && (
                    <span style={{ color: '#fbbf24' }}> · {stepRun.attempt_count} attempts</span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span
                className={`badge`}
                style={{
                  background: statusConf.bgColor,
                  color: statusConf.color,
                  border: `1px solid ${statusConf.color}40`,
                }}
              >
                {isRunning && <span className="step-running-indicator" style={{ width: '6px', height: '6px' }} />}
                {statusConf.label}
              </span>
              <svg
                className="w-4 h-4 transition-transform"
                style={{ color: 'var(--text-muted)', transform: expanded ? 'rotate(180deg)' : undefined }}
                fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
              </svg>
            </div>
          </div>

          {/* Approval Gate Banner */}
          {isAwaiting && canApprove && (
            <div className="approval-banner mt-3">
              <div>
                <div className="font-semibold text-sm" style={{ color: '#f472b6' }}>
                  🔐 Awaiting Your Approval
                </div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {step?.config?.description || 'Review and approve to continue workflow execution'}
                </div>
              </div>
              <button
                className="btn btn-sm"
                style={{
                  background: 'linear-gradient(135deg, #ec4899, #f472b6)',
                  color: 'white',
                  flexShrink: 0,
                }}
                onClick={e => { e.stopPropagation(); setShowApprovalForm(true); }}
              >
                Approve →
              </button>
            </div>
          )}

          {isAwaiting && !canApprove && (
            <div className="mt-3 p-3 rounded-lg text-sm"
              style={{ background: 'rgba(245,158,11,0.1)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.3)' }}>
              ⏸ Workflow paused — waiting for an owner or editor to approve
            </div>
          )}
        </div>

        {/* Approval form */}
        {showApprovalForm && (
          <div className="card mt-2 p-4" style={{ border: '1px solid rgba(236,72,153,0.3)' }}
            onClick={e => e.stopPropagation()}>
            <h4 className="font-semibold text-sm mb-3" style={{ color: 'var(--text-primary)' }}>
              Approve this step
            </h4>
            <div className="mb-3">
              <label className="input-label">Comment (optional)</label>
              <textarea
                className="textarea"
                rows={2}
                value={approvalComment}
                onChange={e => setApprovalComment(e.target.value)}
                placeholder="Add a note about your approval decision..."
              />
            </div>
            <div className="flex gap-2">
              <button
                className="btn btn-success btn-sm flex-1"
                onClick={() => {
                  onApprove(stepRun.id, approvalComment);
                  setShowApprovalForm(false);
                }}
              >
                ✓ Approve & Continue
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowApprovalForm(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Expanded detail */}
        {expanded && (
          <div className="card mt-2 p-4 animate-fade-in" style={{ fontSize: '0.8125rem' }}>
            {stepRun.input && (
              <div className="mb-3">
                <div className="font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Input</div>
                <div className="code-block">{JSON.stringify(stepRun.input, null, 2)}</div>
              </div>
            )}
            {stepRun.output && (
              <div className="mb-3">
                <div className="font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Output</div>
                <div className="code-block" style={{ color: '#34d399' }}>
                  {JSON.stringify(stepRun.output, null, 2)}
                </div>
              </div>
            )}
            {stepRun.error && (
              <div>
                <div className="font-medium mb-1" style={{ color: '#f87171' }}>Error</div>
                <div className="code-block" style={{ color: '#f87171' }}>{stepRun.error}</div>
              </div>
            )}
            {stepRun.approved_by && (
              <div className="mt-3 p-2 rounded-lg text-xs"
                style={{ background: 'rgba(16,185,129,0.1)', color: '#34d399' }}>
                ✓ Approved {format(new Date(stepRun.approved_at), 'MMM d, yyyy HH:mm')}
                {stepRun.approval_comment && ` · "${stepRun.approval_comment}"`}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function RunMonitorPage() {
  const params = useParams();
  const router = useRouter();
  const { selectedOrgRole } = useOrgStore();
  const canApprove = ['owner', 'editor'].includes(selectedOrgRole || '');

  const { data: runData } = useQuery(GET_RUN_DETAIL, {
    variables: { id: params.runId },
  });

  // Live subscription for run status
  const { data: liveRun } = useSubscription(SUBSCRIBE_WORKFLOW_RUN, {
    variables: { id: params.runId },
  });

  // Live subscription for step runs
  const { data: liveSteps } = useSubscription(SUBSCRIBE_STEP_RUNS, {
    variables: { workflow_run_id: params.runId },
  });

  const [approveStep] = useMutation(APPROVE_STEP, {
    onCompleted: (d) => {
      if (d?.approveStep?.success) {
        toast.success('Step approved! Resuming workflow...');
      } else {
        toast.error(d?.approveStep?.message || 'Approval failed');
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const run = liveRun?.workflow_runs_by_pk || runData?.workflow_runs_by_pk;
  const stepRuns = liveSteps?.step_runs || [];
  const workflow = runData?.workflow_runs_by_pk?.workflow;
  const [hasTriggered, setHasTriggered] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);

  useEffect(() => {
    // Recovery: if the run is still pending (or stuck running with no steps),
    // call the server-side API route which uses admin secret — no user token needed.

    // Guard: params.runId must be a valid non-empty string (not undefined or the template literal)
    const runId = typeof params.runId === 'string' && params.runId && params.runId !== '[runId]'
      ? params.runId
      : null;
    if (!runId) return;

    const isStuck =
      run?.status === 'pending' ||
      (run?.status === 'running' && stepRuns.length === 0);

    if (!run || !isStuck || hasTriggered) return;
    setHasTriggered(true);

    fetch('/api/execute-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ run_id: runId }),
    }).then(async (res) => {
      if (!res.ok) {
        let errBody: any = {};
        try { errBody = await res.json(); } catch { /* ignore */ }
        const hint = errBody?.error || errBody?.message || `Execution failed (${res.status})`;
        toast.error(hint, { duration: 8000 });
        setTriggerError(hint);
      }
    }).catch((e) => {
      console.warn('[RunMonitor] recovery warning:', e);
    });
  }, [run?.status, stepRuns.length, hasTriggered, params.runId]);

  const statusConf = STATUS_CONFIG[run?.status] || STATUS_CONFIG.pending;
  const isRunning = run?.status === 'running';
  const isPaused = run?.status === 'paused';
  const isCompleted = run?.status === 'completed';
  const isFailed = run?.status === 'failed';

  const handleApprove = (stepRunId: string, comment: string) => {
    approveStep({ variables: { step_run_id: stepRunId, comment: comment || null } });
  };

  const progress = run?.total_steps
    ? Math.round((run.completed_steps / run.total_steps) * 100)
    : 0;

  return (
    <div className="p-8 max-w-3xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="btn btn-secondary btn-sm">
          ← Back
        </button>
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            {workflow?.name || 'Workflow Run'}
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Run ID: <code style={{ fontSize: '0.75rem' }}>{params.runId}</code>
          </p>
        </div>
      </div>

      {/* Status card */}
      <div className="card mb-6" style={{
        border: isPaused ? '1px solid rgba(245,158,11,0.3)'
          : isCompleted ? '1px solid rgba(16,185,129,0.3)'
          : isFailed ? '1px solid rgba(239,68,68,0.3)'
          : undefined,
      }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="text-2xl">{statusConf.icon}</div>
            <div>
              <div className="font-semibold" style={{ color: statusConf.color }}>
                {isRunning ? (
                  <span className="flex items-center gap-2">
                    <span className="step-running-indicator" />
                    Executing...
                  </span>
                ) : statusConf.label}
              </div>
              {run?.started_at && (
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Started {format(new Date(run.started_at), 'MMM d, yyyy HH:mm:ss')}
                  {run.completed_at && (
                    <> · Completed in {Math.round((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000)}s</>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="text-right">
            <div className="font-bold text-lg" style={{ color: 'var(--text-primary)' }}>
              {run?.completed_steps || 0}/{run?.total_steps || 0}
            </div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>steps</div>
          </div>
        </div>

        {/* Progress bar */}
        {(isRunning || isPaused) && (
          <div>
            <div className="quota-bar">
              <div
                className="quota-bar-fill"
                style={{
                  width: `${progress}%`,
                  background: isPaused
                    ? 'linear-gradient(90deg, #f59e0b, #fbbf24)'
                    : 'linear-gradient(90deg, var(--color-brand-500), var(--color-brand-400))',
                  transition: 'width 0.5s ease',
                }}
              />
            </div>
            <div className="text-xs mt-1 text-right" style={{ color: 'var(--text-muted)' }}>
              {progress}% complete
            </div>
          </div>
        )}

        {/* Live indicator */}
        {(isRunning || isPaused) && (
          <div className="flex items-center gap-2 mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
            <div className="step-running-indicator" style={{ background: isRunning ? '#60a5fa' : '#fbbf24' }} />
            {isRunning ? 'Live — updates in real time via WebSocket subscription' : 'Paused — awaiting approval gate'}
          </div>
        )}
      </div>

      {/* Trigger info */}
      {run && (
        <div className="flex gap-3 mb-6 text-xs" style={{ color: 'var(--text-muted)' }}>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
            {run.trigger_type === 'manual' ? '👆' : run.trigger_type === 'webhook' ? '🔗' : run.trigger_type === 'scheduled' ? '⏰' : '🗄'}&nbsp;
            {run.trigger_type} trigger
          </div>
        </div>
      )}

      {/* Step Timeline */}
      <div className="mb-6">
        <h2 className="font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
          Step Execution
          {isRunning && (
            <span className="ml-2 text-xs font-normal" style={{ color: '#60a5fa' }}>
              ● live
            </span>
          )}
        </h2>

        {stepRuns.length === 0 ? (
          <div className="card text-center py-8">
            {triggerError ? (
              <>
                <div className="text-2xl mb-2">❌</div>
                <p className="text-sm font-medium mb-1" style={{ color: '#f87171' }}>Execution Failed</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)', maxWidth: '28rem', margin: '0 auto' }}>{triggerError}</p>
              </>
            ) : (
              <>
                <div className="step-running-indicator mx-auto mb-3" />
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Initializing steps...</p>
              </>
            )}
          </div>
        ) : (
          <div className="timeline">
            {stepRuns.map((stepRun: any) => (
              <StepRunCard
                key={stepRun.id}
                stepRun={stepRun}
                canApprove={canApprove}
                onApprove={handleApprove}
              />
            ))}
          </div>
        )}
      </div>

      {/* Final output */}
      {isCompleted && run?.output && (
        <div className="card">
          <h3 className="font-semibold mb-3" style={{ color: '#34d399' }}>✅ Final Output</h3>
          <div className="code-block" style={{ color: '#34d399' }}>
            {JSON.stringify(run.output, null, 2)}
          </div>
        </div>
      )}

      {isFailed && run?.error && (
        <div className="card" style={{ border: '1px solid rgba(239,68,68,0.3)' }}>
          <h3 className="font-semibold mb-3" style={{ color: '#f87171' }}>❌ Error</h3>
          <div className="code-block" style={{ color: '#f87171' }}>{run.error}</div>
        </div>
      )}
    </div>
  );
}
