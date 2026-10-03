// O1: `secure` follows the port -- 465 implicit TLS, 587 STARTTLS.
import 'dotenv/config'; // load .env once up front so it cannot leak into a case below
import test from 'node:test';
import assert from 'node:assert/strict';

const load = async (env, tag) => {
  const saved = {};
  for (const k of ['SMTP_PORT', 'SMTP_SECURE']) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, env);
  try {
    return (await import(`../../src/utils/mailer.js?${tag}`)).transporter.options;
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
};

test('port 465 -> secure true', async () => {
  const o = await load({ SMTP_PORT: '465' }, 'p465');
  assert.equal(o.secure, true);
  assert.equal(o.port, 465);
});
test('port 587 -> secure false, port is a number', async () => {
  const o = await load({ SMTP_PORT: '587' }, 'p587');
  assert.equal(o.secure, false);
  assert.equal(o.port, 587);
});
test('SMTP_PORT unset -> 465 / secure', async () => {
  const o = await load({}, 'pdefault');
  assert.equal(o.port, 465);
  assert.equal(o.secure, true);
});
test('SMTP_SECURE overrides the port rule', async () => {
  const o = await load({ SMTP_PORT: '587', SMTP_SECURE: 'true' }, 'poverride');
  assert.equal(o.secure, true);
});
test('no fire-and-forget sender is exported: app mail goes through the outbox', async () => {
  const m = await import('../../src/utils/mailer.js?exports');
  assert.equal(m.sendEmail, undefined);
  assert.equal(typeof m.deliverEmail, 'function');
});
