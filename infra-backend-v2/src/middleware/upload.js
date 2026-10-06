import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { TEMP_DIR as tempDir } from '../config/paths.js';
import { cleanupTempFiles } from '../utils/fileManager.js';

if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const sanitizedOriginal = file.originalname.replace(/\s+/g, '_');
    cb(null, `${uniqueSuffix}-${sanitizedOriginal}`);
  }
});

// S3: allow-list, not block-list. The extension must be on the list and the
// declared MIME type must either match it or be absent/generic (R6: browsers send
// "" or application/octet-stream for .docx/.xlsx/.heic when no app is registered).
// A declared type that contradicts the extension (x.jpg as text/html) is still
// refused, and verifyUploads() then checks the real first bytes against the
// extension. (Downloads are served with nosniff + attachment for non-images.)
export const ALLOWED_UPLOADS = Object.freeze({
  '.jpg':  ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png':  ['image/png'],
  '.webp': ['image/webp'],
  '.heic': ['image/heic', 'image/heif'],
  '.pdf':  ['application/pdf'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
});

const GENERIC_MIME = new Set(['', 'application/octet-stream']);

/** Limits the forms check before sending (served by GET /api/meta/upload-limits). */
export const UPLOAD_LIMITS = Object.freeze({
  max_file_bytes: 30 * 1024 * 1024,
  // The host proxy accepts 100 MB per request; stay clear of it.
  max_request_bytes: 90 * 1024 * 1024,
  raise_ticket_files: 5,
  report_photos: 10,
  report_documents: 10,
  attachment_files: 10,
  allowed_extensions: Object.keys(ALLOWED_UPLOADS),
});

const unsupported = (message) => Object.assign(new Error(message), { code: 'UNSUPPORTED_FILE_TYPE' });

export function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowed = ALLOWED_UPLOADS[ext];
  if (allowed && (allowed.includes(file.mimetype) || GENERIC_MIME.has(file.mimetype))) return cb(null, true);
  cb(unsupported(`File type not allowed: ${file.originalname}. Allowed: ${Object.keys(ALLOWED_UPLOADS).join(', ')}.`));
}

// First bytes per extension. WebP and HEIC carry their marker after a 4-byte field.
const startsWith = (buf, bytes, at = 0) => bytes.every((b, i) => buf[at + i] === b);
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
const SIGNATURE = Object.freeze({
  '.jpg':  (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  '.jpeg': (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  '.png':  (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  '.webp': (b) => startsWith(b, ascii('RIFF')) && startsWith(b, ascii('WEBP'), 8),
  '.heic': (b) => startsWith(b, ascii('ftyp'), 4),
  '.pdf':  (b) => b.subarray(0, 1024).includes('%PDF-'),
  '.xlsx': (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]),
  '.docx': (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]),
});

export function matchesSignature(ext, head) {
  const check = SIGNATURE[ext];
  return !!check && check(head);
}

const filesOf = (req) => (!req.files ? [] : Array.isArray(req.files) ? req.files : Object.values(req.files).flat());

/** Runs after multer: refuses (and deletes) any file whose bytes do not match its extension. */
export async function verifyUploads(req, _res, next) {
  const files = filesOf(req);
  try {
    for (const file of files) {
      const handle = await fs.promises.open(file.path, 'r');
      try {
        const head = Buffer.alloc(1024);
        const { bytesRead } = await handle.read(head, 0, head.length, 0);
        const ext = path.extname(file.originalname).toLowerCase();
        if (!matchesSignature(ext, head.subarray(0, bytesRead))) {
          throw unsupported(`File content does not match its type: ${file.originalname}.`);
        }
      } finally {
        await handle.close();
      }
    }
    return next();
  } catch (err) {
    cleanupTempFiles(files);
    return next(err);
  }
}

const multerUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: UPLOAD_LIMITS.max_file_bytes },
});

// Every route gets multer followed by the byte check; Express flattens the array.
export const upload = {
  array: (name, max) => [multerUpload.array(name, max), verifyUploads],
  fields: (spec) => [multerUpload.fields(spec), verifyUploads],
};
