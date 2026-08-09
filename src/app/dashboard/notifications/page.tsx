'use client';

import { useQuery } from '@apollo/client';
import { useOrgStore } from '@/lib/store';
import { GET_ORG_NOTIFICATIONS } from '@/lib/graphql/operations';
import { format, formatDistanceToNow } from 'date-fns';
import Link from 'next/link';

const CHANNEL_CONFIG: Record<string, { icon: string; color: string }> = {
  slack: { icon: '💬', color: '#36C5F0' },
  email: { icon: '📧', color: '#818cf8' },
  system: { icon: '🔔', color: '#f59e0b' },
  db_write: { icon: '💾', color: '#10b981' },
};

export default function NotificationsPage() {
  const { selectedOrgId } = useOrgStore();

  const { data, loading } = useQuery(GET_ORG_NOTIFICATIONS, {
    variables: { org_id: selectedOrgId, limit: 50 },
    skip: !selectedOrgId,
    pollInterval: 10000, // Refresh every 10s
  });

  const notifications = data?.notifications || [];

  return (
    <div className="p-8 animate-fade-in max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Notifications</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          Alerts and events from your workflow runs
        </p>
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map(i => <div key={i} className="skeleton h-16 rounded-xl"/>)}
        </div>
      ) : notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div style={{ fontSize: '4rem' }}>🔔</div>
          <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>No notifications yet</h2>
          <p style={{ color: 'var(--text-muted)' }}>
            Notifications appear when notify or db_write steps run
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {notifications.map((notif: any) => {
            const channelConf = CHANNEL_CONFIG[notif.channel] || CHANNEL_CONFIG.system;
            return (
              <div key={notif.id} className="card p-4 flex gap-4">
                <div className="text-xl flex-shrink-0">{channelConf.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <div className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                      {notif.title}
                    </div>
                    <div className="text-xs flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                      {formatDistanceToNow(new Date(notif.sent_at), { addSuffix: true })}
                    </div>
                  </div>
                  <div className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>
                    {notif.message}
                  </div>
                  <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <span className="px-1.5 py-0.5 rounded"
                      style={{ background: `${channelConf.color}20`, color: channelConf.color }}>
                      {notif.channel}
                    </span>
                    {notif.workflow_run && (
                      <Link href={`/dashboard/runs/${notif.workflow_run.id}`}
                        className="hover:underline" style={{ color: 'var(--color-brand-400)' }}>
                        View run →
                      </Link>
                    )}
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
