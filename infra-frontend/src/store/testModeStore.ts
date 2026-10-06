import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { useAuthStore } from './authStore';

export const TEST_ROLES = ['APPLICANT', 'JE', 'AE', 'SE', 'DEAN', 'DIRECTOR', 'CLERICAL', 'ACCOUNTANT'] as const;
export type TestRole = (typeof TEST_ROLES)[number];

interface TestModeState {
  ticketId: number | null;
  actAs: TestRole | null;
  set: (ticketId: number, actAs: TestRole) => void;
  clear: () => void;
}

/** Sysadmin "act as" state for one test ticket. Lives in sessionStorage and clears on logout. */
export const useTestModeStore = create<TestModeState>()(
  persist(
    (set) => ({
      ticketId: null,
      actAs: null,
      set: (ticketId, actAs) => set({ ticketId, actAs }),
      clear: () => set({ ticketId: null, actAs: null }),
    }),
    { name: 'deanery-test-mode', storage: createJSONStorage(() => sessionStorage) }
  )
);

useAuthStore.subscribe((s) => {
  if (!s.isAuthenticated) useTestModeStore.getState().clear();
});

/** X-Test-Role is sent only for requests about the chosen test ticket, or for file downloads while a role is being played. */
export function testRoleFor(url: string | undefined): TestRole | null {
  const { ticketId, actAs } = useTestModeStore.getState();
  if (!url || ticketId === null || actAs === null) return null;
  const path = url.split('?')[0];
  if (new RegExp(`^/?tickets/${ticketId}(/|$)`).test(path)) return actAs;
  if (/^\/?attachments\/\d+$/.test(path)) return actAs;
  return null;
}
