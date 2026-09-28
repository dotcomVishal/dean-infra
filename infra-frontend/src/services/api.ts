import axios from 'axios';
import { auth } from '../config/firebase';
import { useAuthStore } from '../store/authStore';

const baseURL = import.meta.env.VITE_API_URL || '/api';

export const api = axios.create({
  baseURL,
});

// F1: fetch the token straight from the Firebase SDK, which transparently
// refreshes it, rather than a one-time value cached at login that expired
// after 1 hour. Falls back to the store's cached token for the brief window
// right after a page load before Firebase has restored its session.
api.interceptors.request.use(async (config) => {
  const token = auth.currentUser
    ? await auth.currentUser.getIdToken()
    : useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = 'Bearer ' + token;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);
