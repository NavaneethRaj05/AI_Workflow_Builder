/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@apollo/client';
import { useOrgStore } from '@/lib/store';
import {
  GET_ORG_MEMBERS,
  UPDATE_ORG_MEMBER_ROLE,
  REMOVE_ORG_MEMBER,
  CREATE_ORGANIZATION,
  ADD_ORG_MEMBER,
  GET_USERS_BY_EMAIL,
  GET_MY_ORGS,
} from '@/lib/graphql/operations';
import { useUserData } from '@nhost/react';
import toast from 'react-hot-toast';
import { formatDistanceToNow } from 'date-fns';

const ROLE_COLORS: Record<string, { color: string; bg: string }> = {
  owner: { color: '#818cf8', bg: 'rgba(99,102,241,0.15)' },
  editor: { color: '#34d399', bg: 'rgba(16,185,129,0.1)' },
  viewer: { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' },
};

export default function AdminPage() {
  const { selectedOrgId, setSelectedOrg } = useOrgStore();
  const user = useUserData();

  // Create org form
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgSlug, setNewOrgSlug] = useState('');
  const [showCreateOrg, setShowCreateOrg] = useState(false);

  // Invite member form
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'owner' | 'editor' | 'viewer'>('editor');
  const [inviteUserId, setInviteUserId] = useState<string | null>(null);
  const [lookupDone, setLookupDone] = useState(false);

  const { data: membersData, refetch: refetchMembers } = useQuery(GET_ORG_MEMBERS, {
    variables: { org_id: selectedOrgId },
    skip: !selectedOrgId,
  });

  const { data: orgsData, refetch: refetchOrgs } = useQuery(GET_MY_ORGS);

  const { refetch: lookupUser, loading: lookingUp } = useQuery(GET_USERS_BY_EMAIL, {
    variables: { email: inviteEmail },
    skip: true,
    errorPolicy: 'ignore',
  });

  const [updateRole] = useMutation(UPDATE_ORG_MEMBER_ROLE, {
    onCompleted: () => { toast.success('Role updated'); refetchMembers(); },
    onError: (e) => toast.error(e.message),
  });

  const [removeMember] = useMutation(REMOVE_ORG_MEMBER, {
    onCompleted: () => { toast.success('Member removed'); refetchMembers(); },
    onError: (e) => toast.error(e.message),
  });

  const [createOrg] = useMutation(CREATE_ORGANIZATION, {
    onCompleted: (d) => {
      const org = d?.insert_organizations_one;
      toast.success(`Organization "${org.name}" created!`);
      setNewOrgName('');
      setNewOrgSlug('');
      setShowCreateOrg(false);
      refetchOrgs();
    },
    onError: (e) => toast.error(e.message),
  });

  const [addMember] = useMutation(ADD_ORG_MEMBER, {
    onCompleted: () => {
      toast.success('Member added!');
      setInviteEmail('');
      setInviteUserId(null);
      setLookupDone(false);
      refetchMembers();
    },
    onError: (e) => toast.error(e.message),
  });

  const members = membersData?.org_members || [];
  const orgs = orgsData?.org_members || [];

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const handleLookupUser = async () => {
    const input = inviteEmail.trim();
    if (!input) return;

    // Check if input is already a UUID
    if (uuidRegex.test(input)) {
      setInviteUserId(input);
      setLookupDone(true);
      toast.success('Using provided User ID');
      return;
    }

    try {
      const result = await lookupUser({ email: input });
      const found = result.data?.users?.[0];
      setLookupDone(true);
      if (found) {
        setInviteUserId(found.id);
        toast.success(`Found: ${found.displayName || found.email}`);
      } else {
        setInviteUserId(null);
        toast.error('No user found with that email. You can also paste their User ID directly.');
      }
    } catch {
      setLookupDone(true);
      // If users query is not exposed, allow direct UUID entry
      setInviteUserId(null);
      toast.error('User lookup by email unavailable. Please enter User ID (UUID) directly.');
    }
  };

  const handleAddMember = () => {
    if (!inviteUserId || !selectedOrgId) return;
    addMember({ variables: { org_id: selectedOrgId, user_id: inviteUserId, role: inviteRole } });
  };

  const handleCreateOrg = async () => {
    if (!newOrgName.trim() || !newOrgSlug.trim()) {
      toast.error('Name and slug are required');
      return;
    }
    const baseSlug = newOrgSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    let result: any;
    let finalSlug = baseSlug;

    try {
      try {
        result = await createOrg({ variables: { name: newOrgName.trim(), slug: finalSlug } });
      } catch (firstErr: any) {
        if (firstErr.message?.includes('organizations_slug_key') || firstErr.message?.includes('unique constraint')) {
          // Retry with unique 4-character suffix
          finalSlug = `${baseSlug}-${Math.random().toString(36).substring(2, 6)}`;
          result = await createOrg({ variables: { name: newOrgName.trim(), slug: finalSlug } });
        } else {
          throw firstErr;
        }
      }

      const org = result?.data?.insert_organizations_one;
      const orgId = org?.id;

      if (orgId && user?.id) {
        try {
          await addMember({ variables: { org_id: orgId, user_id: user.id, role: 'owner' } });
        } catch (memberErr: any) {
          if (!memberErr.message?.includes('unique') && !memberErr.message?.includes('duplicate')) {
            console.warn('Could not add self as owner:', memberErr.message);
          }
        }
        toast.success(`Organization "${org.name}" created!`);
        setNewOrgName('');
        setNewOrgSlug('');
        setShowCreateOrg(false);
        setSelectedOrg(orgId, 'owner');
        await refetchOrgs();
        await refetchMembers();
      }
    } catch (err: any) {
      if (err.message?.includes('organizations_slug_key') || err.message?.includes('unique constraint')) {
        toast.error('Slug is already taken. Please try a different slug.');
      } else {
        toast.error(err.message || 'Failed to create organization');
      }
    }
  };

  if (!selectedOrgId) {
    return (
      <div className="flex items-center justify-center h-full flex-col gap-4">
        <div style={{ fontSize: '3rem' }}>🏢</div>
        <p style={{ color: 'var(--text-muted)' }}>Select an organization to manage its team.</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-3xl mx-auto animate-fade-in">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Team & Admin</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          Manage members, roles, and organizations
        </p>
      </div>

      {/* Create New Organization */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Organizations</h2>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              You belong to {orgs.length} org{orgs.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            id="create-org-btn"
            onClick={() => setShowCreateOrg(!showCreateOrg)}
          >
            {showCreateOrg ? 'Cancel' : '+ New Org'}
          </button>
        </div>

        {/* Org list */}
        <div className="flex flex-col gap-2 mb-4">
          {orgs.map((m: any) => (
            <div key={m.organization.id}
              className="flex items-center justify-between px-3 py-2.5 rounded-lg"
              style={{
                background: m.organization.id === selectedOrgId ? 'rgba(99,102,241,0.1)' : 'var(--bg-overlay)',
                border: m.organization.id === selectedOrgId ? '1px solid rgba(99,102,241,0.2)' : '1px solid transparent',
              }}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold"
                  style={{ background: 'var(--bg-elevated)', color: 'var(--color-brand-400)' }}>
                  {m.organization.name[0].toUpperCase()}
                </div>
                <div>
                  <div className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>{m.organization.name}</div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>/{m.organization.slug} · {m.role}</div>
                </div>
              </div>
              {m.organization.id !== selectedOrgId && (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setSelectedOrg(m.organization.id, m.role)}
                >
                  Switch
                </button>
              )}
              {m.organization.id === selectedOrgId && (
                <span className="text-xs" style={{ color: 'var(--color-brand-400)' }}>● current</span>
              )}
            </div>
          ))}
        </div>

        {/* Create org form */}
        {showCreateOrg && (
          <div className="p-4 rounded-xl animate-fade-in" style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border-default)' }}>
            <h3 className="font-semibold text-sm mb-3" style={{ color: 'var(--text-primary)' }}>
              Create New Organization
            </h3>
            <div className="grid gap-3 mb-4">
              <div>
                <label className="input-label">Organization Name</label>
                <input
                  className="input"
                  placeholder="Acme Corp"
                  id="new-org-name"
                  value={newOrgName}
                  onChange={e => {
                    setNewOrgName(e.target.value);
                    setNewOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '-'));
                  }}
                />
              </div>
              <div>
                <label className="input-label">Slug (URL-safe identifier)</label>
                <input
                  className="input"
                  placeholder="acme-corp"
                  id="new-org-slug"
                  value={newOrgSlug}
                  onChange={e => setNewOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                />
              </div>
            </div>
            <button
              className="btn btn-primary"
              id="confirm-create-org"
              onClick={handleCreateOrg}
              disabled={!newOrgName.trim() || !newOrgSlug.trim()}
            >
              Create Organization
            </button>
          </div>
        )}
      </div>

      {/* Team Members */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>
              Team Members
            </h2>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {members.length} member{members.length !== 1 ? 's' : ''} in this organization
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {members.map((member: any) => {
            const roleConf = ROLE_COLORS[member.role] || ROLE_COLORS.viewer;
            const isMe = member.user?.id === user?.id;
            return (
              <div key={member.id}
                className="flex items-center justify-between px-3 py-3 rounded-lg"
                style={{ background: 'var(--bg-overlay)' }}>
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                    style={{ background: 'linear-gradient(135deg, #4f46e5, #818cf8)', color: 'white' }}>
                    {(member.user?.displayName || member.user?.email || '?')[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                      {member.user?.displayName || 'Unknown'}
                      {isMe && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>(you)</span>}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {member.user?.email}
                      {member.created_at && ` · Joined ${formatDistanceToNow(new Date(member.created_at), { addSuffix: true })}`}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="badge text-xs" style={{ background: roleConf.bg, color: roleConf.color }}>
                    {member.role}
                  </span>

                  {!isMe && (
                    <>
                      <select
                        className="select text-xs py-1"
                        style={{ minWidth: '90px' }}
                        value={member.role}
                        id={`role-${member.id}`}
                        onChange={e => updateRole({ variables: { id: member.id, role: e.target.value } })}
                      >
                        <option value="owner">owner</option>
                        <option value="editor">editor</option>
                        <option value="viewer">viewer</option>
                      </select>
                      <button
                        className="btn btn-sm"
                        id={`remove-${member.id}`}
                        style={{ color: '#f87171', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}
                        onClick={() => {
                          if (window.confirm(`Remove ${member.user?.displayName || member.user?.email} from this org?`)) {
                            removeMember({ variables: { id: member.id } });
                          }
                        }}
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Invite Member */}
      <div className="card">
        <h2 className="font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Invite Member</h2>
        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
          The user must already have a FlowForge account.
        </p>

        <div className="grid gap-3">
          <div>
            <label className="input-label">Email Address</label>
            <div className="flex gap-2">
              <input
                className="input flex-1"
                placeholder="user@example.com"
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={e => { setInviteEmail(e.target.value); setInviteUserId(null); setLookupDone(false); }}
                onKeyDown={e => e.key === 'Enter' && handleLookupUser()}
              />
              <button
                className="btn btn-secondary"
                id="lookup-user-btn"
                onClick={handleLookupUser}
                disabled={lookingUp || !inviteEmail.trim()}
              >
                {lookingUp ? '...' : 'Find'}
              </button>
            </div>
            {lookupDone && !inviteUserId && (
              <p className="text-xs mt-1" style={{ color: '#f87171' }}>
                No account found with that email.
              </p>
            )}
            {inviteUserId && (
              <p className="text-xs mt-1" style={{ color: '#34d399' }}>
                ✓ User found — select a role and add them.
              </p>
            )}
          </div>

          <div>
            <label className="input-label">Role</label>
            <select
              className="select"
              id="invite-role"
              value={inviteRole}
              onChange={e => setInviteRole(e.target.value as 'owner' | 'editor' | 'viewer')}
            >
              <option value="owner">owner — full control</option>
              <option value="editor">editor — can build & run workflows</option>
              <option value="viewer">viewer — read-only</option>
            </select>
          </div>

          <button
            className="btn btn-primary"
            id="add-member-btn"
            onClick={handleAddMember}
            disabled={!inviteUserId}
          >
            Add to Organization
          </button>
        </div>
      </div>
    </div>
  );
}
