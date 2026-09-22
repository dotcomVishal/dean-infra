import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

// Vite substitutes env vars at BUILD time. A missing one silently becomes
// `undefined` and Firebase then fails deep inside the Google popup with a
// message that points nowhere near the cause. Fail here instead.
const REQUIRED = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
] as const;

const missing = REQUIRED.filter((key) => !import.meta.env[key]);
if (missing.length > 0) {
  throw new Error(
    `[firebase] Missing env var(s): ${missing.join(', ')}. ` +
    `Copy .env.example to .env.local and fill them in.`
  );
}

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Force the account chooser so any Google account can be selected
googleProvider.setCustomParameters({ prompt: 'select_account' });
