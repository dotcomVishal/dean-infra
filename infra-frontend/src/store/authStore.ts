import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { onIdTokenChanged } from 'firebase/auth';
import { auth } from '../config/firebase';

interface User {
  id: number;
  firebase_uid: string;
  name: string;
  email: string;
  role: string;
  department: string;
}

interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  token: string | null;
  login: (user: User, token: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      isAuthenticated: false,
      user: null,
      token: null,
      login: (user, token) => set({ isAuthenticated: true, user, token }),
      logout: () => set({ isAuthenticated: false, user: null, token: null }),
    }),
    {
      name: 'deanery-auth-storage', // Securely locks state in localStorage
      // F1: the token expires after 1 hour and must never be replayed stale
      // from localStorage. Only the role/profile survive a refresh; the token
      // itself is refilled in-memory by the onIdTokenChanged listener below.
      partialize: (state) => ({ isAuthenticated: state.isAuthenticated, user: state.user }),
    }
  )
);

// F1: Firebase silently rotates the ID token in the background. This keeps
// the in-memory token current so the API client always sends a live one,
// instead of the one-time token captured at login that expired after 1 hour.
onIdTokenChanged(auth, async (firebaseUser) => {
  if (!firebaseUser) {
    if (useAuthStore.getState().isAuthenticated) useAuthStore.getState().logout();
    return;
  }
  const token = await firebaseUser.getIdToken();
  useAuthStore.setState({ token });
});
/** True only when a session AND a user profile exist. Every guard and the /login route use this one rule, so they can never disagree and bounce the user between /login and /. */
export const useIsSignedIn = () => useAuthStore((s) => s.isAuthenticated && s.user !== null);
