import axios from 'axios';
import { auth } from '../config/firebase';
import { useAuthStore } from '../store/authStore';
import { testRoleFor } from '../store/testModeStore';
import { toast } from '../store/toastStore';

const baseURL = import.meta.env.VITE_API_URL || '/api';

export const api = axios.create({
  baseURL,
});

// F1: fetch the token straight from the Firebase SDK, which transparently
// refreshes it, rather than a one-time value cached at login that expired
// after 1 hour. Waits for Firebase to restore its session first, so requests
// right after a page load carry a token instead of a 401.
api.interceptors.request.use(async (config) => {
  await auth.authStateReady();
  const token = auth.currentUser
    ? await auth.currentUser.getIdToken()
    : useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = 'Bearer ' + token;
  }
  // Sysadmin test mode: only for the chosen test ticket (see store/testModeStore).
  const actAs = testRoleFor(config.url);
  if (actAs) config.headers['X-Test-Role'] = actAs;
  return config;
});

// One 401 handler: clear the session and let the router send the user to
// /login. No hard reload, and nothing at all when the user is already on
// /login (a failed sign-in must show its error, not reload the page).
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && useAuthStore.getState().isAuthenticated) {
      useAuthStore.getState().logout();
      toast.info('Session ended. Sign in again.');
    }
    return Promise.reject(error);
  }
);
