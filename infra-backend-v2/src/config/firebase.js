import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import fs from 'fs';

// Safely load the service account key using ES Modules
const serviceAccount = JSON.parse(
  fs.readFileSync(new URL('../../serviceAccountKey.json', import.meta.url))
);

const app = initializeApp({
  credential: cert(serviceAccount)
});

// Export the auth module directly
export const auth = getAuth(app);