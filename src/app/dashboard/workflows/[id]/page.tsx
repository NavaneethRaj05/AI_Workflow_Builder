'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@apollo/client';
import { useParams, useRouter } from 'next/navigation';
import { useOrgStore } from '@/lib/store';
import {
  GET_WORKFLOW_DETAIL,
  UPSERT_WORKFLOW,
  INSERT_WORKFLOW_STEPS,
  DELETE_WORKFLOW_STEPS,
  UPSERT_WORKFLOW_TRIGGER,
  TRIGGER_WORKFLOW_RUN,
} from '@/lib/graphql/operations';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import toast from 'react-hot-toast';
import { v4 as uuidv4 } from 'uuid';

// Step type definitions
const STEP_TYPES = [
  { value: 'llm_call', label: 'LLM Call', icon: '🤖', color: '#8b5cf6', ownerOnly: false },
  { value: 'http_request', label: 'HTTP Request', icon: '🌐', color: '#06b6d4', ownerOnly: false },
  { value: 'db_write', label: 'DB Write', icon: '💾', color: '#10b981', ownerOnly: true },
  { value: 'notify', label: 'Notify', icon: '🔔', color: '#f59e0b', ownerOnly: true },
  { value: 'conditional_branch', label: 'Conditional Branch', icon: '🔀', color: '#f97316', ownerOnly: false },
  { value: 'approval_gate', label: 'Approval Gate', icon: '🔐', color: '#ec4899', ownerOnly: false },
];

const TRIGGER_TYPES = [
  { value: 'manual', label: 'Manual', icon: '👆' },
  { value: 'webhook', label: 'Webhook', icon: '🔗' },
  { value: 'scheduled', label: 'Scheduled (Cron)', icon: '⏰' },
  { value: 'database_event', label: 'Database Event', icon: '🗄' },
];

interface Step {
  id: string;
  name: string;
  step_type: string;
  step_order: number;
  config: Record<string, any>;
  is_enabled: boolean;
  isNew?: boolean;
}

// Sortable step card
function SortableStep({
  step,
  isOwner,
  onUpdate,
  onDelete,
  onSelect,
  isSelected,
}: {
  step: Step;
  isOwner: boolean;
  onUpdate: (id: string, changes: Partial<Step>) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string) => void;
  isSelected: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.id });
  const typeConf = STEP_TYPES.find(t => t.value === step.step_type);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className={`step-card step-${step.step_type}`}
        style={{
          borderColor: isSelected ? typeConf?.color + '80' : undefined,
          background: isSelected ? 'var(--bg-overlay)' : undefined,
          cursor: isSelected ? 'default' : 'grab',
        }}
        onClick={() => onSelect(step.id)}
      >
        {/* Drag handle */}
        <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing"
          style={{ color: 'var(--text-muted)' }}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 8h16M4 16h16"/>
          </svg>
        </div>

        {/* Icon */}
        <div className="w-9 h-9 rounded-lg flex items-center justify-center text-base flex-shrink-0"
          style={{ background: `${typeConf?.color}20`, border: `1px solid ${typeConf?.color}40` }}>
          {typeConf?.icon}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
            {step.name}
          </div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {typeConf?.label}
            {typeConf?.ownerOnly && <span className="ml-1 text-yellow-500">★ owner only</span>}
          </div>
        </div>

        {/* Toggle + Delete */}
        <div className="flex items-center gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
          <button
            className="w-5 h-5 rounded flex items-center justify-center transition-colors"
            style={{
              background: step.is_enabled ? 'rgba(16,185,129,0.2)' : 'var(--bg-muted)',
              border: `1px solid ${step.is_enabled ? 'rgba(16,185,129,0.4)' : 'var(--border-subtle)'}`,
            }}
            onClick={() => onUpdate(step.id, { is_enabled: !step.is_enabled })}
            title={step.is_enabled ? 'Disable' : 'Enable'}
          >
            <span style={{ fontSize: '0.6rem', color: step.is_enabled ? '#34d399' : 'var(--text-muted)' }}>
              {step.is_enabled ? '✓' : '○'}
            </span>
          </button>
          <button
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
            style={{ color: 'var(--text-muted)' }}
            onClick={() => onDelete(step.id)}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// Step config editor panel
function StepConfigPanel({ step, isOwner, onUpdate }: { step: Step; isOwner: boolean; onUpdate: (id: string, changes: Partial<Step>) => void }) {
  const handleConfigChange = (key: string, value: any) => {
    onUpdate(step.id, { config: { ...step.config, [key]: value } });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Step name */}
      <div>
        <label className="input-label">Step Name</label>
        <input
          className="input"
          value={step.name}
          onChange={e => onUpdate(step.id, { name: e.target.value })}
          placeholder="My Step"
        />
      </div>

      {/* Step type */}
      <div>
        <label className="input-label">Step Type</label>
        <select
          className="select"
          value={step.step_type}
          onChange={e => onUpdate(step.id, { step_type: e.target.value })}
        >
          {STEP_TYPES.filter(t => isOwner || !t.ownerOnly).map(t => (
            <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
          ))}
        </select>
      </div>

      {/* Type-specific config */}
      {step.step_type === 'llm_call' && (
        <>
          <div>
            <label className="input-label">Model</label>
            <select className="select" value={step.config.model || 'llama-3.3-70b-versatile'}
              onChange={e => handleConfigChange('model', e.target.value)}>
              <option value="llama-3.3-70b-versatile">Llama 3.3 70B (Groq)</option>
              <option value="llama-3.1-8b-instant">Llama 3.1 8B Instant (Groq)</option>
              <option value="mixtral-8x7b-32768">Mixtral 8x7B (Groq)</option>
              <option value="gemma2-9b-it">Gemma2 9B (Groq)</option>
            </select>
          </div>
          <div>
            <label className="input-label">System Prompt</label>
            <textarea className="textarea" rows={3}
              value={step.config.system_prompt || ''}
              onChange={e => handleConfigChange('system_prompt', e.target.value)}
              placeholder="You are a helpful assistant..." />
          </div>
          <div>
            <label className="input-label">User Prompt Template</label>
            <textarea className="textarea" rows={3}
              value={step.config.user_prompt || ''}
              onChange={e => handleConfigChange('user_prompt', e.target.value)}
              placeholder="Process this input: {{input}}" />
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              Use {'{{input}}'} to reference previous step output
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="input-label">Max Tokens</label>
              <input className="input" type="number" min={1} max={4096}
                value={step.config.max_tokens || 500}
                onChange={e => handleConfigChange('max_tokens', parseInt(e.target.value))} />
            </div>
            <div>
              <label className="input-label">Temperature (0–1)</label>
              <input className="input" type="number" min={0} max={1} step={0.1}
                value={step.config.temperature || 0.7}
                onChange={e => handleConfigChange('temperature', parseFloat(e.target.value))} />
            </div>
          </div>
        </>
      )}

      {step.step_type === 'http_request' && (
        <>
          <div>
            <label className="input-label">URL</label>
            <input className="input" value={step.config.url || ''}
              onChange={e => handleConfigChange('url', e.target.value)}
              placeholder="https://api.example.com/endpoint" />
          </div>
          <div>
            <label className="input-label">Method</label>
            <select className="select" value={step.config.method || 'POST'}
              onChange={e => handleConfigChange('method', e.target.value)}>
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="input-label">Body Template (JSON)</label>
            <textarea className="textarea" rows={3}
              value={typeof step.config.body_template === 'object'
                ? JSON.stringify(step.config.body_template, null, 2)
                : step.config.body_template || ''}
              onChange={e => handleConfigChange('body_template', e.target.value)}
              placeholder='{"data": "{{input}}"}' />
          </div>
        </>
      )}

      {step.step_type === 'db_write' && (
        <>
          <div>
            <label className="input-label">Title</label>
            <input className="input" value={step.config.title || ''}
              onChange={e => handleConfigChange('title', e.target.value)}
              placeholder="Step Result" />
          </div>
          <div>
            <label className="input-label">Message Template</label>
            <textarea className="textarea" rows={2}
              value={step.config.message_template || ''}
              onChange={e => handleConfigChange('message_template', e.target.value)}
              placeholder="Result: {{input}}" />
          </div>
        </>
      )}

      {step.step_type === 'notify' && (
        <>
          <div>
            <label className="input-label">Channel</label>
            <select className="select" value={step.config.channel || 'system'}
              onChange={e => handleConfigChange('channel', e.target.value)}>
              <option value="system">System (DB log)</option>
              <option value="slack">Slack Webhook</option>
            </select>
          </div>
          <div>
            <label className="input-label">Title</label>
            <input className="input" value={step.config.title || ''}
              onChange={e => handleConfigChange('title', e.target.value)}
              placeholder="Workflow Alert" />
          </div>
          <div>
            <label className="input-label">Message Template</label>
            <textarea className="textarea" rows={2}
              value={step.config.message || ''}
              onChange={e => handleConfigChange('message', e.target.value)}
              placeholder="Step completed: {{input}}" />
          </div>
          {step.config.channel === 'slack' && (
            <div>
              <label className="input-label">Slack Webhook URL</label>
              <input className="input" type="url" value={step.config.slack_webhook_url || ''}
                onChange={e => handleConfigChange('slack_webhook_url', e.target.value)}
                placeholder="https://hooks.slack.com/services/..." />
            </div>
          )}
        </>
      )}

      {step.step_type === 'conditional_branch' && (
        <>
          <div>
            <label className="input-label">Condition (JavaScript expression)</label>
            <textarea className="textarea" rows={2}
              value={step.config.condition || ''}
              onChange={e => handleConfigChange('condition', e.target.value)}
              placeholder="input.score > 0.5" />
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              Use <code>input</code> to reference previous output. E.g.: <code>input.llm_response.includes('yes')</code>
            </p>
          </div>
          <div>
            <label className="input-label">True Branch Output (JSON)</label>
            <textarea className="textarea" rows={2}
              value={typeof step.config.true_output === 'object'
                ? JSON.stringify(step.config.true_output) : step.config.true_output || ''}
              onChange={e => { try { handleConfigChange('true_output', JSON.parse(e.target.value)); } catch { handleConfigChange('true_output', e.target.value); }}}
              placeholder='{"action": "proceed", "priority": "high"}' />
          </div>
          <div>
            <label className="input-label">False Branch Output (JSON)</label>
            <textarea className="textarea" rows={2}
              value={typeof step.config.false_output === 'object'
                ? JSON.stringify(step.config.false_output) : step.config.false_output || ''}
              onChange={e => { try { handleConfigChange('false_output', JSON.parse(e.target.value)); } catch { handleConfigChange('false_output', e.target.value); }}}
              placeholder='{"action": "skip", "priority": "low"}' />
          </div>
        </>
      )}

      {step.step_type === 'approval_gate' && (
        <>
          <div>
            <label className="input-label">Gate Description</label>
            <textarea className="textarea" rows={2}
              value={step.config.description || ''}
              onChange={e => handleConfigChange('description', e.target.value)}
              placeholder="Describe what the approver should review..." />
          </div>
          <div>
            <label className="input-label">Required Approver Roles</label>
            <div className="flex gap-2">
              {['owner', 'editor'].map(role => (
                <label key={role} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox"
                    checked={(step.config.required_approver_roles || ['owner', 'editor']).includes(role)}
                    onChange={e => {
                      const current = step.config.required_approver_roles || ['owner', 'editor'];
                      const updated = e.target.checked
                        ? [...new Set([...current, role])]
                        : current.filter((r: string) => r !== role);
                      handleConfigChange('required_approver_roles', updated);
                    }}
                  />
                  <span className="text-sm capitalize" style={{ color: 'var(--text-secondary)' }}>{role}</span>
                </label>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function WorkflowEditorPage() {
  const params = useParams();
  const router = useRouter();
  const { selectedOrgId, selectedOrgRole } = useOrgStore();
  const isNew = params.id === 'new';
  const isOwner = selectedOrgRole === 'owner';
  const isEditor = ['owner', 'editor'].includes(selectedOrgRole || '');

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [steps, setSteps] = useState<Step[]>([]);
  const [deletedStepIds, setDeletedStepIds] = useState<string[]>([]);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [triggerType, setTriggerType] = useState('manual');
  const [triggerConfig, setTriggerConfig] = useState<any>({});
  const [triggerId, setTriggerId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const { data } = useQuery(GET_WORKFLOW_DETAIL, {
    variables: { id: params.id },
    skip: isNew,
  });

  // Load existing workflow
  useEffect(() => {
    if (data?.workflows_by_pk) {
      const wf = data.workflows_by_pk;
      setName(wf.name);
      setDescription(wf.description || '');
      setIsActive(wf.is_active);
      setSteps(wf.workflow_steps.map((s: any) => ({ ...s })));
      const trigger = wf.workflow_triggers?.[0];
      if (trigger) {
        setTriggerType(trigger.trigger_type);
        setTriggerConfig(trigger.config || {});
        setTriggerId(trigger.id);
      }
    }
  }, [data]);

  const [upsertWorkflow] = useMutation(UPSERT_WORKFLOW);
  const [insertSteps] = useMutation(INSERT_WORKFLOW_STEPS);
  const [deleteSteps] = useMutation(DELETE_WORKFLOW_STEPS);
  const [upsertTrigger] = useMutation(UPSERT_WORKFLOW_TRIGGER);
  const [triggerRun] = useMutation(TRIGGER_WORKFLOW_RUN, {
    onCompleted: (d) => {
      const runId = d?.triggerWorkflowRun?.run_id;
      if (runId) {
        toast.success('Workflow started!');
        router.push(`/dashboard/runs/${runId}`);
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const addStep = (type: string) => {
    const typeConf = STEP_TYPES.find(t => t.value === type);
    const newStep: Step = {
      id: uuidv4(),
      name: typeConf?.label || 'New Step',
      step_type: type,
      step_order: steps.length,
      config: {},
      is_enabled: true,
      isNew: true,
    };
    setSteps(prev => [...prev, newStep]);
    setSelectedStepId(newStep.id);
  };

  const updateStep = (id: string, changes: Partial<Step>) => {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, ...changes } : s));
  };

  const deleteStep = (id: string) => {
    const step = steps.find(s => s.id === id);
    if (step && !step.isNew) {
      setDeletedStepIds(prev => [...prev, id]);
    }
    setSteps(prev => prev.filter(s => s.id !== id));
    if (selectedStepId === id) setSelectedStepId(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setSteps(prev => {
      const oldIdx = prev.findIndex(s => s.id === active.id);
      const newIdx = prev.findIndex(s => s.id === over.id);
      return arrayMove(prev, oldIdx, newIdx).map((s, i) => ({ ...s, step_order: i }));
    });
  };

  const handleSave = async () => {
    if (!name.trim()) return toast.error('Workflow name is required');
    if (!selectedOrgId) return toast.error('Select an organization first');
    setSaving(true);

    try {
      // 1. Upsert workflow
      const wfResult = await upsertWorkflow({
        variables: {
          id: isNew ? undefined : params.id,
          name,
          description,
          org_id: selectedOrgId,
          is_active: isActive,
        },
      });
      const workflowId = wfResult.data?.insert_workflows_one?.id;

      // 2. Delete removed steps
      if (deletedStepIds.length > 0) {
        await deleteSteps({ variables: { ids: deletedStepIds } });
      }

      // 3. Upsert all steps
      if (steps.length > 0) {
        await insertSteps({
          variables: {
            steps: steps.map((s, i) => ({
              id: s.isNew ? undefined : s.id,
              workflow_id: workflowId || params.id,
              name: s.name,
              step_order: i,
              step_type: s.step_type,
              config: s.config,
              is_enabled: s.is_enabled,
            })),
          },
        });
      }

      // 4. Upsert trigger
      await upsertTrigger({
        variables: {
          id: triggerId || undefined,
          workflow_id: workflowId || params.id,
          trigger_type: triggerType,
          config: triggerConfig,
          is_active: true,
        },
      });

      toast.success('Workflow saved!');
      if (isNew && workflowId) {
        router.replace(`/dashboard/workflows/${workflowId}`);
      }
    } catch (err: any) {
      toast.error(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const selectedStep = steps.find(s => s.id === selectedStepId);

  return (
    <div className="flex h-full animate-fade-in" style={{ height: '100vh', overflow: 'hidden' }}>
      {/* Left panel — Canvas */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center gap-4 px-6 py-4 border-b"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)', flexShrink: 0 }}>
          <button onClick={() => router.back()} className="btn btn-secondary btn-sm">
            ← Back
          </button>
          <div className="flex-1 min-w-0">
            <input
              className="text-lg font-bold outline-none border-none bg-transparent"
              style={{ color: 'var(--text-primary)', fontFamily: 'inherit', width: '100%' }}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Untitled Workflow"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Active</span>
              <div
                className="w-10 h-6 rounded-full relative transition-all cursor-pointer"
                style={{
                  background: isActive ? 'var(--color-brand-500)' : 'var(--bg-muted)',
                  border: '1px solid var(--border-default)',
                }}
                onClick={() => setIsActive(!isActive)}
              >
                <div className="w-4 h-4 rounded-full absolute top-0.5 transition-all"
                  style={{
                    left: isActive ? 'calc(100% - 18px)' : '2px',
                    background: 'white',
                  }} />
              </div>
            </label>

            {isEditor && (
              <>
                <button className="btn btn-secondary btn-sm" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving...' : 'Save'}
                </button>
                {!isNew && (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => triggerRun({ variables: { workflow_id: params.id } })}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/>
                    </svg>
                    Run Now
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Step canvas */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-xl mx-auto">
              <div className="mb-4">
                <label className="input-label">Description</label>
                <input className="input" value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="What does this workflow do?" />
              </div>

              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                  Steps ({steps.length})
                </h3>
                {isEditor && (
                  <div className="relative group">
                    <button className="btn btn-secondary btn-sm">
                      + Add Step ▾
                    </button>
                    <div className="absolute right-0 top-8 z-50 min-w-48 hidden group-hover:flex flex-col gap-1 p-2 rounded-xl"
                      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', boxShadow: 'var(--shadow-lg)' }}>
                      {STEP_TYPES.filter(t => isOwner || !t.ownerOnly).map(t => (
                        <button key={t.value} onClick={() => addStep(t.value)}
                          className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-colors"
                          style={{ color: 'var(--text-primary)' }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-overlay)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                          <span>{t.icon}</span>
                          <span>{t.label}</span>
                          {t.ownerOnly && <span className="ml-auto text-xs" style={{ color: '#fbbf24' }}>owner</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {steps.length === 0 ? (
                <div className="card text-center py-12 border-dashed"
                  style={{ borderStyle: 'dashed', borderColor: 'var(--border-default)' }}>
                  <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>🔧</div>
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    Add steps using the button above to build your workflow
                  </p>
                </div>
              ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={steps.map(s => s.id)} strategy={verticalListSortingStrategy}>
                    <div className="workflow-canvas">
                      {steps.map((step, idx) => (
                        <div key={step.id}>
                          {idx > 0 && <div className="workflow-step-connector" />}
                          <SortableStep
                            step={step}
                            isOwner={isOwner}
                            onUpdate={updateStep}
                            onDelete={deleteStep}
                            onSelect={setSelectedStepId}
                            isSelected={selectedStepId === step.id}
                          />
                        </div>
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}

              {/* Trigger config */}
              <div className="mt-6">
                <h3 className="font-semibold text-sm mb-3" style={{ color: 'var(--text-primary)' }}>
                  Trigger
                </h3>
                <div className="card">
                  <div className="mb-3">
                    <label className="input-label">Trigger Type</label>
                    <select className="select" value={triggerType}
                      onChange={e => setTriggerType(e.target.value)}
                      disabled={!isEditor}>
                      {TRIGGER_TYPES.filter(t =>
                        t.value !== 'webhook' || isOwner
                      ).map(t => (
                        <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
                      ))}
                    </select>
                  </div>

                  {triggerType === 'webhook' && (
                    <div>
                      <label className="input-label">Trigger ID (share with external system)</label>
                      <div className="code-block break-all">{triggerId || 'Save first to get ID'}</div>
                    </div>
                  )}

                  {triggerType === 'scheduled' && (
                    <div>
                      <label className="input-label">Cron Expression</label>
                      <input className="input" value={triggerConfig.cron_expression || ''}
                        onChange={e => setTriggerConfig({ ...triggerConfig, cron_expression: e.target.value })}
                        placeholder="0 9 * * 1 (every Monday at 9am UTC)" />
                      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                        Standard 5-field cron: minute hour day month weekday
                      </p>
                    </div>
                  )}

                  {triggerType === 'database_event' && (
                    <>
                      <div>
                        <label className="input-label">Watched Table Name</label>
                        <input className="input" value={triggerConfig.watched_table || ''}
                          onChange={e => setTriggerConfig({ ...triggerConfig, watched_table: e.target.value })}
                          placeholder="notifications" />
                      </div>
                      <div className="mt-3">
                        <label className="input-label">Operations</label>
                        <div className="flex gap-3">
                          {['INSERT', 'UPDATE', 'DELETE'].map(op => (
                            <label key={op} className="flex items-center gap-1.5 cursor-pointer">
                              <input type="checkbox"
                                checked={(triggerConfig.operations || ['INSERT']).includes(op)}
                                onChange={e => {
                                  const current = triggerConfig.operations || ['INSERT'];
                                  setTriggerConfig({
                                    ...triggerConfig,
                                    operations: e.target.checked
                                      ? [...new Set([...current, op])]
                                      : current.filter((o: string) => o !== op),
                                  });
                                }} />
                              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{op}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Right panel — Step config */}
          {selectedStep && (
            <div className="w-80 border-l overflow-y-auto p-5 flex-shrink-0"
              style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                  Configure Step
                </h3>
                <button onClick={() => setSelectedStepId(null)}
                  style={{ color: 'var(--text-muted)' }}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                </button>
              </div>
              <StepConfigPanel step={selectedStep} isOwner={isOwner} onUpdate={updateStep} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
