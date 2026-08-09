'use client';

import { useQuery, useMutation } from '@apollo/client';
import { useOrgStore } from '@/lib/store';
import { GET_ORG_MEMBERS, UPDATE_ORG_MEMBER_ROLE, REMOVE_ORG_MEMBER } from '@/lib/graphql/operations';
import { formatDistanceToNow } from 'date-fns';
import toast from 'react-hot-toast';
import { useUserData } from '@nhost/react';

const ROLE_DESCRIPTIONS: Record<string, { desc: string; color: string }> = {
  owner: { desc: 'Full control — manages members, all step types, all triggers', color: '#818cf8' },
  editor: { desc: 'Create/edit workflows, trigger runs — no member management', color: '#34d399' },
  viewer: { desc: 'Read-only access — cannot trigger runs or edit', color: '#94a3b8' },
};

export default function AdminPage() {
  const { selectedOrgId, selectedOrgRole } = useOrgStore();
  const isOwner = selectedOrgRole === 'owner';
  const currentUser = useUserData();

  const { data, loading, refetch } = useQuery(GET_ORG_MEMBERS, {
    variables: { org_id: selectedOrgId },
    skip: !selectedOrgId,
  });

  const [updateRole] = useMutation(UPDATE_ORG_MEMBER_ROLE, {
    onCompleted: () => { toast.success('Role updated'); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const [removeMember] = useMutation(REMOVE_ORG_MEMBER, {
    onCompleted: () => { toast.success('Member removed'); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const members = data?.org_members || [];

  if (!isOwner) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div style={{ fontSize: '3rem' }}>🔒</div>
        <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>Access Restricted</h2>
        <p style={{ color: 'var(--text-muted)' }}>Only organization owners can manage team members.</p>
      </div>
    );
  }

  return (
    <div className="p-8 animate-fade-in max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Team Management</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          {members.length} member{members.length !== 1 ? 's' : ''} in this organization
        </p>
      </div>

      {/* Role legend */}
      <div className="card mb-6">
        <h3 className="font-semibold text-sm mb-3" style={{ color: 'var(--text-primary)' }}>Role Permissions</h3>
        <div className="grid gap-2">
          {Object.entries(ROLE_DESCRIPTIONS).map(([role, { desc, color }]) => (
            <div key={role} className="flex items-start gap-3">
              <span className="badge flex-shrink-0" style={{
                background: `${color}20`, color, border: `1px solid ${color}40`
              }}>
                {role}
              </span>
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Members list */}
      {loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map(i => <div key={i} className="skeleton h-16 rounded-xl"/>)}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {members.map((member: any) => {
            const isSelf = member.user?.id === currentUser?.id;
            const { desc, color } = ROLE_DESCRIPTIONS[member.role] || {};

            return (
              <div key={member.id} className="card flex items-center gap-4 p-4">
                {/* Avatar */}
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg, #4f46e5, #818cf8)', color: 'white' }}>
                  {member.user?.displayName?.[0]?.toUpperCase() ||
                   member.user?.email?.[0]?.toUpperCase() || '?'}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                      {member.user?.displayName || member.user?.email}
                    </span>
                    {isSelf && (
                      <span className="text-xs px-1.5 py-0.5 rounded"
                        style={{ background: 'rgba(99,102,241,0.15)', color: 'var(--color-brand-400)' }}>
                        you
                      </span>
                    )}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {member.user?.email} · Joined {formatDistanceToNow(new Date(member.created_at), { addSuffix: true })}
                  </div>
                </div>

                {/* Role selector */}
                {!isSelf ? (
                  <select
                    className="select"
                    style={{ width: 'auto', minWidth: '100px' }}
                    value={member.role}
                    onChange={e => updateRole({ variables: { id: member.id, role: e.target.value } })}
                  >
                    {Object.keys(ROLE_DESCRIPTIONS).map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                ) : (
                  <span className="badge"
                    style={{ background: `${color}20`, color, border: `1px solid ${color}40` }}>
                    {member.role}
                  </span>
                )}

                {/* Remove button */}
                {!isSelf && (
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => {
                      if (confirm(`Remove ${member.user?.email} from the organization?`)) {
                        removeMember({ variables: { id: member.id } });
                      }
                    }}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                    </svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-6 card" style={{ background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.15)' }}>
        <h3 className="font-semibold text-sm mb-2" style={{ color: 'var(--text-primary)' }}>
          🔐 Security Note
        </h3>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          All permissions are enforced at two layers: Hasura row-level security scopes every query to the caller's own org,
          and the Action handlers check roles at runtime before executing sensitive operations.
          Even if someone guesses a workflow ID, Hasura will return an empty result if they're not in the correct org.
        </p>
      </div>
    </div>
  );
}
