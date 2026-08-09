import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface OrgStore {
  selectedOrgId: string | null;
  selectedOrgRole: string | null;
  setSelectedOrg: (orgId: string, role: string) => void;
  clearOrg: () => void;
}

export const useOrgStore = create<OrgStore>()(
  persist(
    (set) => ({
      selectedOrgId: null,
      selectedOrgRole: null,
      setSelectedOrg: (orgId, role) => set({ selectedOrgId: orgId, selectedOrgRole: role }),
      clearOrg: () => set({ selectedOrgId: null, selectedOrgRole: null }),
    }),
    {
      name: 'flowforge-org',
    }
  )
);
