import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const keyPath = path.join(__dirname, '../../serviceAccountKey.json');

// Fail fast, fail loud, fail ACTIONABLE. A bare readFileSync here throws a raw
// ENOENT stack trace that tells a new contributor nothing.
if (!fs.existsSync(keyPath)) {
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

let serviceAccount;
try {
  serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
} catch (err) {
  console.error(`[firebase] ${keyPath} exists but is not valid JSON: ${err.message}`);
  process.exit(1);
}

const app = initializeApp({ credential: cert(serviceAccount) });
export const auth = getAuth(app);
