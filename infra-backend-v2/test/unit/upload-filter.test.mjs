// P1: the extension decides; the declared type only has to be plausible; content is verified.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileFilter, matchesSignature } from '../../src/middleware/upload.js';
import { fileMeta } from '../../src/utils/fileManager.js';

const run = (originalname, mimetype) => { let r; fileFilter({}, { originalname, mimetype }, (e, ok) => { r = { e, ok }; }); return r; };

test('honest clients with odd declared types are accepted', () => {
  for (const [n, m] of [
    ['a.xlsx', ''], ['a.docx', 'application/octet-stream'], ['a.heic', ''], ['a.jpg', 'image/pjpeg'],
    ['a.pdf', 'application/x-pdf'], ['a.JPEG', 'image/jpeg'], ['a.xlsx', 'application/x-zip-compressed'],
  ]) assert.equal(run(n, m).ok, true, `${n} ${m}`);
});

test('wrong extensions and contradicting declared types are refused', () => {
  for (const [n, m] of [['a.exe', ''], ['a.html', 'text/html'], ['a.svg', 'image/svg+xml'], ['a.jpg', 'text/html'], ['a.pdf', 'image/png'], ['noext', 'image/jpeg']]) {
    const r = run(n, m);
    assert.equal(r.ok, undefined, n);
    assert.equal(r.e.code, 'UNSUPPORTED_FILE_TYPE');
  }
});

test('signatures', () => {
  const b = (...bytes) => Buffer.from(bytes);
  assert.ok(matchesSignature('.jpg', b(0xff, 0xd8, 0xff, 0xe0)));
  assert.ok(matchesSignature('.png', b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)));
  assert.ok(matchesSignature('.pdf', Buffer.from('%PDF-1.7')));
  assert.ok(matchesSignature('.xlsx', b(0x50, 0x4b, 0x03, 0x04)));
  assert.ok(matchesSignature('.webp', Buffer.from('RIFF\0\0\0\0WEBP')));
  assert.ok(matchesSignature('.heic', Buffer.from('\0\0\0\x18ftypheic')));
  assert.ok(matchesSignature('.heic', Buffer.from('\0\0\0\x18ftypmif1')));
  assert.equal(matchesSignature('.heic', Buffer.from('\0\0\0\x18ftypmp42')), false);
  assert.equal(matchesSignature('.pdf', Buffer.from('MZ\x90\0')), false);
  assert.equal(matchesSignature('.jpg', Buffer.from('<html>')), false);
  assert.equal(matchesSignature('.exe', Buffer.from('MZ')), false);
});

test('fileMeta strips path characters and caps the length', () => {
  assert.equal(fileMeta({ originalname: '../../etc/passwd.pdf', size: 5 }).originalName, '.._.._etc_passwd.pdf');
  assert.equal(fileMeta({ originalname: 'x'.repeat(400) }).originalName.length, 255);
  assert.equal(fileMeta({ originalname: 'अनुमान.docx', size: 9 }).originalName, 'अनुमान.docx');
  assert.equal(fileMeta(null).originalName, null);
});
