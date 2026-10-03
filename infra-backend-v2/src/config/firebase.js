import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Docker sets GOOGLE_APPLICATION_CREDENTIALS to the mounted key path
// (see docker-compose.yml); local/bare-metal runs fall back to the file
// next to the backend root (S11).
const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, '../../serviceAccountKey.json');

// Tests run without a Firebase key (CI has none). They replace `auth.verifyIdToken`
// themselves; the stub refuses everything until they do.
const useStub = process.env.NODE_ENV === 'test' && !fs.existsSync(keyPath);

// Fail fast, fail loud, fail ACTIONABLE. A bare readFileSync here throws a raw
// ENOENT stack trace that tells a new contributor nothing.
if (!useStub && !fs.existsSync(keyPath)) {
  console.error(`
============================================================
 FIREBASE SERVICE ACCOUNT KEY NOT FOUND
============================================================
 Expected at:
   ${keyPath}

 This file is a PRIVATE KEY and is deliberately not in git.

 To create it:
   1. https://console.firebase.google.com
   2. Project settings  ->  Service accounts
   3. "Generate new private key"  ->  confirm
   4. Save the downloaded JSON as:
        infra-backend-v2/serviceAccountKey.json

 Then:  cp .env.example .env   and fill it in.
 Re-check everything with:  node verify-setup.js
============================================================
`);
  process.exit(1);
}

let authInstance;
if (useStub) {
  authInstance = { verifyIdToken: async () => { throw new Error('firebase stub: no verifyIdToken installed'); } };
} else {
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  } catch (err) {
    console.error(`[firebase] ${keyPath} exists but is not valid JSON: ${err.message}`);
    process.exit(1);
  }
  authInstance = getAuth(initializeApp({ credential: cert(serviceAccount) }));
}
export const auth = authInstance;
