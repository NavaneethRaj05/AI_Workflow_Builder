/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useSubscription } from '@apollo/client';
import { useOrgStore } from '@/lib/store';
import { SUBSCRIBE_ORG_NOTIFICATIONS } from '@/lib/graphql/operations';
import Link from 'next/link';
import { formatDistanceToNow, format } from 'date-fns';

const CHANNEL_CONFIG: Record<string, { color: string; bg: string; icon: string; label: string }> = {
  slack: { color: '#818cf8', bg: 'rgba(99,102,241,0.15)', icon: '💬', label: 'Slack' },
  email: { color: '#34d399', bg: 'rgba(16,185,129,0.1)', icon: '📧', label: 'Email' },
  system: { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', icon: '🔔', label: 'System' },
  db_write: { color: '#10b981', bg: 'rgba(16,185,129,0.1)', icon: '💾', label: 'DB Write' },
};

export default function NotificationsPage() {
  const { selectedOrgId } = useOrgStore();

  const { data, loading } = useSubscription(SUBSCRIBE_ORG_NOTIFICATIONS, {
    variables: { org_id: selectedOrgId, limit: 50 },
    skip: !selectedOrgId,
  });

  const notifications = data?.notifications || [];

  if (!selectedOrgId) {
    return (
      <div className="flex items-center justify-center h-full flex-col gap-4">
        <div style={{ fontSize: '3rem' }}>🏢</div>
        <p style={{ color: 'var(--text-muted)' }}>Select an organization to view notifications.</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-3xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
            Notifications
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            Real-time · {notifications.length} notification{notifications.length !== 1 ? 's' : ''}
            {' '}<span style={{ color: '#60a5fa' }}>● live</span>
          </p>
        </div>
      </div>

      {/* Live indicator */}
      <div className="flex items-center gap-2 mb-6 text-xs px-3 py-2 rounded-lg"
        style={{ background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.1)', color: 'var(--text-muted)' }}>
        <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#60a5fa' }} />
        Updates stream live via GraphQL WebSocket subscription — no refresh needed
      </div>

      {loading && notifications.length === 0 ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map(i => <div key={i} className="skeleton h-20 rounded-xl" />)}
        </div>
      ) : notifications.length === 0 ? (
        <div className="card text-center py-20">
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔔</div>
          <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
            No notifications yet
          </h3>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Notifications appear when workflow steps of type <code>notify</code> or <code>db_write</code> complete.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {notifications.map((n: any) => {
            const channelConf = CHANNEL_CONFIG[n.channel] || CHANNEL_CONFIG.system;
            return (
              <div key={n.id} className="card p-4">
                <div className="flex items-start gap-3">
                  {/* Channel icon */}
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                    style={{ background: channelConf.bg, border: `1px solid ${channelConf.color}30` }}>
                    {channelConf.icon}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                        {n.title}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="badge text-xs"
                          style={{ background: channelConf.bg, color: channelConf.color }}>
                          {channelConf.label}
                        </span>
                        <span className="text-xs" style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {formatDistanceToNow(new Date(n.sent_at), { addSuffix: true })}
                        </span>
                      </div>
                    </div>

                    <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>
                      {n.message}
                    </p>

                    <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                      <span>{format(new Date(n.sent_at), 'MMM d, yyyy HH:mm:ss')}</span>
                      {n.workflow_run && (
                        <>
                          <span>·</span>
                          <Link
                            href={`/dashboard/runs/${n.workflow_run.id}`}
                            className="flex items-center gap-1"
                            style={{ color: 'var(--color-brand-400)' }}
                          >
                            <span>⚡ {n.workflow_run.workflow?.name || 'Workflow'}</span>
                            <span>→</span>
                          </Link>
                          <span
                            className="badge"
                            style={{
                              background: n.workflow_run.status === 'completed' ? 'rgba(16,185,129,0.1)' :
                                n.workflow_run.status === 'failed' ? 'rgba(239,68,68,0.1)' : 'rgba(148,163,184,0.1)',
                              color: n.workflow_run.status === 'completed' ? '#34d399' :
                                n.workflow_run.status === 'failed' ? '#f87171' : '#94a3b8',
                            }}
                          >
                            {n.workflow_run.status}
                          </span>
                        </>
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
