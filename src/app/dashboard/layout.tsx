/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthenticationStatus, useUserData } from '@nhost/react';
import Link from 'next/link';
import { useQuery } from '@apollo/client';
import { GET_MY_ORGS } from '@/lib/graphql/operations';
import { useOrgStore } from '@/lib/store';
import nhost from '@/lib/nhost';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthenticationStatus();
  const user = useUserData();
  const router = useRouter();
  const pathname = usePathname();
  const { selectedOrgId, setSelectedOrg } = useOrgStore();

  const { data: orgsData } = useQuery(GET_MY_ORGS, {
    skip: !isAuthenticated,
  });

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  // Auto-select first org
  useEffect(() => {
    if (orgsData?.org_members?.length > 0 && !selectedOrgId) {
      const first = orgsData.org_members[0];
      setSelectedOrg(first.organization.id, first.role);
    }
  }, [orgsData, selectedOrgId, setSelectedOrg]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-base)' }}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center animate-pulse-glow"
            style={{ background: 'linear-gradient(135deg, #4f46e5, #818cf8)' }}>
            <svg className="w-5 h-5 text-white animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          </div>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading your workspace...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return null;

  const orgs = orgsData?.org_members || [];
  const currentOrg = orgs.find((m: any) => m.organization.id === selectedOrgId);
  const isOwner = currentOrg?.role === 'owner';
  const isEditor = ['owner', 'editor'].includes(currentOrg?.role || '');

  const navItems = [
    { href: '/dashboard', label: 'Overview', icon: GridIcon },
    { href: '/dashboard/workflows', label: 'Workflows', icon: WorkflowIcon },
    { href: '/dashboard/runs', label: 'Run History', icon: HistoryIcon },
    ...(isOwner ? [{ href: '/dashboard/admin', label: 'Team', icon: TeamIcon }] : []),
    { href: '/dashboard/notifications', label: 'Notifications', icon: BellIcon },
  ];

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg-base)' }}>
      {/* Sidebar */}
      <aside className="sidebar">
        {/* Logo */}
        <div className="p-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          <Link href="/dashboard" className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #4f46e5, #818cf8)' }}>
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z"/>
              </svg>
            </div>
            <span className="font-bold text-base gradient-text">FlowForge</span>
          </Link>
        </div>

        {/* Org Selector */}
        {orgs.length > 0 && (
          <div className="p-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
              Organization
            </div>
            <div className="flex flex-col gap-1">
              {orgs.map((member: any) => (
                <button
                  key={member.organization.id}
                  onClick={() => setSelectedOrg(member.organization.id, member.role)}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all text-sm"
                  style={{
                    background: selectedOrgId === member.organization.id
                      ? 'rgba(99, 102, 241, 0.15)'
                      : 'transparent',
                    color: selectedOrgId === member.organization.id
                      ? 'var(--text-primary)'
                      : 'var(--text-secondary)',
                    border: selectedOrgId === member.organization.id
                      ? '1px solid rgba(99, 102, 241, 0.2)'
                      : '1px solid transparent',
                  }}
                >
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
                    style={{ background: 'var(--bg-overlay)', color: 'var(--color-brand-400)' }}>
                    {member.organization.name[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium truncate">{member.organization.name}</div>
                    <div className="text-xs capitalize" style={{ color: 'var(--text-muted)' }}>
                      {member.role}
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {/* Quota indicator */}
            {currentOrg && (
              <div className="mt-3 p-3 rounded-lg" style={{ background: 'var(--bg-overlay)' }}>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Monthly Quota</span>
                  <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                    {currentOrg.organization.quota_used}/{currentOrg.organization.quota_limit}
                  </span>
                </div>
                <div className="quota-bar">
                  <div
                    className={`quota-bar-fill ${
                      currentOrg.organization.quota_used / currentOrg.organization.quota_limit > 0.9
                        ? 'danger'
                        : currentOrg.organization.quota_used / currentOrg.organization.quota_limit > 0.7
                        ? 'warning'
                        : ''
                    }`}
                    style={{
                      width: `${Math.min(100, (currentOrg.organization.quota_used / currentOrg.organization.quota_limit) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 p-3 flex flex-col gap-1">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`nav-link ${
                (href === '/dashboard' && pathname === '/dashboard') || 
                (href !== '/dashboard' && (pathname === href || pathname.startsWith(href + '/')))
                  ? 'active'
                  : ''
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </Link>
          ))}
        </nav>

        {/* User info */}
        <div className="p-3 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="flex items-center gap-3 px-2 py-1.5">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
              style={{ background: 'linear-gradient(135deg, #4f46e5, #818cf8)', color: 'white' }}>
              {user?.displayName?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                {user?.displayName || 'User'}
              </div>
              <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                {user?.email}
              </div>
            </div>
            <button
              onClick={() => {
                nhost.auth.signOut();
                router.push('/login');
              }}
              className="p-1.5 rounded-lg transition-colors"
              style={{ color: 'var(--text-muted)' }}
              title="Sign out"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/>
              </svg>
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="main-content">
        {children}
      </main>
    </div>
  );
}

// Icons
function GridIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"/>
    </svg>
  );
}

function WorkflowIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
    </svg>
  );
}

function HistoryIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
    </svg>
  );
}

function TeamIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/>
    </svg>
  );
}

function BellIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>
    </svg>
  );
}
