// R6: valid files are not refused for an empty browser MIME type, and the real
// bytes are checked against the extension.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileFilter, matchesSignature, verifyUploads } from '../../src/middleware/upload.js';
import { replyRequirement, planMessages } from '../../src/config/workflow.js';

const filter = (originalname, mimetype) => { let r; fileFilter({}, { originalname, mimetype }, (e, ok) => { r = { e, ok }; }); return r; };

test('empty or generic declared type is accepted for allowed extensions', () => {
  for (const name of ['a.docx', 'a.xlsx', 'a.heic', 'a.pdf', 'a.jpg']) {
    assert.equal(filter(name, '').ok, true, name);
    assert.equal(filter(name, 'application/octet-stream').ok, true, name);
  }
});

test('a contradicting declared type, or an unlisted extension, is still refused', () => {
  for (const [n, m] of [['a.jpg', 'text/html'], ['a.pdf', 'image/png'], ['a.exe', ''], ['a.dwg', 'application/octet-stream'], ['noext', '']]) {
    assert.equal(filter(n, m).e?.code, 'UNSUPPORTED_FILE_TYPE', n);
  }
});

test('signatures: each type accepts its own bytes and refuses others', () => {
  const b = (...x) => Buffer.from(x);
  assert.ok(matchesSignature('.jpg', b(0xff, 0xd8, 0xff, 0xe0)));
  assert.ok(matchesSignature('.png', b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0)));
  assert.ok(matchesSignature('.webp', Buffer.from('RIFF\0\0\0\0WEBPVP8 ')));
  assert.ok(matchesSignature('.heic', Buffer.from('\0\0\0\x18ftypheic')));
  assert.ok(matchesSignature('.pdf', Buffer.from('%PDF-1.7')));
  assert.ok(matchesSignature('.docx', b(0x50, 0x4b, 0x03, 0x04)));
  assert.ok(matchesSignature('.xlsx', b(0x50, 0x4b, 0x03, 0x04)));
  assert.equal(matchesSignature('.pdf', Buffer.from('<html>hello')), false);
  assert.equal(matchesSignature('.jpg', Buffer.from('%PDF-1.7')), false);
  assert.equal(matchesSignature('.exe', Buffer.from('MZ')), false);
});

test('verifyUploads removes a file whose bytes do not match and reports 415', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-'));
  const fake = path.join(dir, 'fake.pdf');
  const good = path.join(dir, 'good.pdf');
  fs.writeFileSync(fake, '<html>not a pdf</html>');
  fs.writeFileSync(good, '%PDF-1.4 ok');

  let err;
  await verifyUploads({ files: [{ path: fake, originalname: 'fake.pdf' }] }, {}, (e) => { err = e; });
  assert.equal(err.code, 'UNSUPPORTED_FILE_TYPE');
  assert.equal(fs.existsSync(fake), false, 'bad file deleted');

  err = undefined;
  await verifyUploads({ files: { site_photos: [{ path: good, originalname: 'good.pdf' }] } }, {}, (e) => { err = e; });
  assert.equal(err, undefined);
  assert.equal(fs.existsSync(good), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('replyRequirement matches what planMessages enforces (R8)', () => {
  const req = { id: 7, to_desk: 'JE', author_desk: 'AE' };
  for (const action of ['FORWARD', 'SUBMIT_REPORT', 'APPROVE', 'REQUEST_CHANGES', 'REJECT', 'ASSIGN_JE']) {
    for (const fromDesk of ['JE', 'AE']) {
      for (const openRequest of [null, req]) {
        const need = replyRequirement({ action, fromDesk, openRequest }).reply_required;
        let threw = false;
        try {
          planMessages({ action, fromDesk, toDesk: 'AE', payload: action === 'REQUEST_CHANGES' || action === 'REJECT' ? { message: 'x' } : {}, openRequest });
        } catch (e) { threw = e.code === 'MESSAGE_REQUIRED'; }
        assert.equal(need, threw && action !== 'REQUEST_CHANGES' && action !== 'REJECT', `${action} ${fromDesk} ${openRequest ? 'open' : 'none'}`);
      }
    }
  }
  assert.deepEqual(replyRequirement({ action: 'SUBMIT_REPORT', fromDesk: 'JE', openRequest: req }), { reply_required: true, reply_to_desk: 'AE' });
  assert.deepEqual(replyRequirement({ action: 'FORWARD', fromDesk: 'AE', openRequest: req }), { reply_required: false, reply_to_desk: null });
});
