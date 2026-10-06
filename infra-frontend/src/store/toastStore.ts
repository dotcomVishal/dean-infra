import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastState {
  toasts: ToastItem[];
  push: (kind: ToastKind, message: string) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;
const LIFETIME_MS: Record<ToastKind, number> = { success: 4000, info: 4000, error: 7000 };

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (kind, message) => {
    if (!message) return;
    const id = nextId++;
    // Keep the stack short: a burst of errors must not cover the screen.
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }].slice(-4) }));
    setTimeout(() => get().dismiss(id), LIFETIME_MS[kind]);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Drop-in replacement for window.alert(): toast.success('Saved'), toast.error(err). */
export const toast = {
  success: (message: string) => useToastStore.getState().push('success', message),
  error: (message: string) => useToastStore.getState().push('error', message),
  info: (message: string) => useToastStore.getState().push('info', message),
};
