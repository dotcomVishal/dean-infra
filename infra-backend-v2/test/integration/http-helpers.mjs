// Real HTTP against the real Express app, with Firebase stubbed out.
//
// firebase.js refuses to load without a service-account key, so a throwaway
// key is generated and the verifier is replaced: a bearer token is simply the
// user's firebase_uid. Import this module BEFORE anything that pulls in app.js,
// and set any RATE_LIMIT_* variable before importing it.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { generateKeyPairSync } from 'crypto';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dean-fb-'));
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const keyPath = path.join(dir, 'key.json');
fs.writeFileSync(keyPath, JSON.stringify({
  type: 'service_account', project_id: 'ci-stub', private_key_id: 'ci',
  private_key: privateKey, client_email: 'ci@ci-stub.iam.gserviceaccount.com', client_id: '1',
}));
process.env.GOOGLE_APPLICATION_CREDENTIALS = keyPath;

const { auth } = await import('../../src/config/firebase.js');
auth.verifyIdToken = async (token) => {
  if (!token.startsWith('ci-')) throw Object.assign(new Error('bad token'), { code: 'auth/argument-error' });
  return { uid: token, email: `${token}@test.local`, email_verified: true, firebase: { sign_in_provider: 'google.com' } };
};

const { default: app } = await import('../../src/app.js');
const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
export const baseUrl = `http://127.0.0.1:${server.address().port}`;
export const stopServer = async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(dir, { recursive: true, force: true });
};

/** Authenticated request. `body` may be a plain object (JSON) or a FormData. */
export async function call(firebaseUid, method, url, body) {
  const headers = { Authorization: `Bearer ${firebaseUid}` };
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(baseUrl + url, { method, headers, body: payload });
  const text = Buffer.from(await res.arrayBuffer()).toString('utf8'); // keeps a BOM, which res.text() would drop
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: res.status, body: json, text, headers: res.headers };
}

// Minimal files that pass the allow-list and the magic-byte check.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('ci photo bytes')]);
const PDF = Buffer.from('%PDF-1.4\nci estimate\n');
export const sampleJpeg = (name = 'site.jpg') => new File([JPEG], name, { type: 'image/jpeg' });
export const samplePdf = (name = 'estimate.pdf') => new File([PDF], name, { type: 'application/pdf' });
