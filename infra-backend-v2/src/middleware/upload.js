import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import logger from '../utils/logger.js';
import { uploadRoot } from '../utils/fileManager.js';

const tempDir = () => {
  const dir = path.join(uploadRoot(), 'temp');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

// Stored name carries no user text: `<timestamp>-<random>.<ext>`. The original name
// is kept in infra_attachments.original_name, so a long or non-ASCII name can never
// overflow a path column or the file system.
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, tempDir()),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

// S3: allow-list, not block-list. The EXTENSION decides what is accepted; the declared
// MIME type only has to be plausible, because browsers take it from the operating
// system: a PC without Office reports .xlsx/.docx with an empty type, HEIC is empty on
// most non-Apple systems, some report JPEG as image/pjpeg and PDF as application/x-pdf.
// The real type is then verified from the file's first bytes (see verifyUploadedFiles).
// (Downloads are served with nosniff + attachment for non-images regardless.)
export const ALLOWED_UPLOADS = Object.freeze({
  '.jpg':  ['image/jpeg', 'image/pjpeg', 'image/jpg'],
  '.jpeg': ['image/jpeg', 'image/pjpeg', 'image/jpg'],
  '.png':  ['image/png', 'image/x-png'],
  '.webp': ['image/webp'],
  '.heic': ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'],
  '.pdf':  ['application/pdf', 'application/x-pdf', 'application/acrobat'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/x-zip-compressed', 'application/zip'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/x-zip-compressed', 'application/zip'],
});

const UNKNOWN_TYPES = new Set(['', 'application/octet-stream', 'binary/octet-stream']);

const unsupported = (message) => Object.assign(new Error(message), { code: 'UNSUPPORTED_FILE_TYPE' });

export function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  const declared = String(file.mimetype ?? '').toLowerCase();
  const accepted = ALLOWED_UPLOADS[ext];
  if (accepted && (UNKNOWN_TYPES.has(declared) || accepted.includes(declared))) return cb(null, true);
  logger.warn('upload rejected', {
    requestId: req?.id, route: req?.originalUrl?.split('?')[0], code: 'UNSUPPORTED_FILE_TYPE',
    reason: accepted ? 'declared type does not match extension' : 'extension not allowed',
    extension: ext, declaredType: declared,
  });
  cb(unsupported(`File type not allowed: ${file.originalname}. Allowed: ${Object.keys(ALLOWED_UPLOADS).join(', ')}.`));
}

const startsWith = (buf, bytes, offset = 0) => bytes.every((b, i) => buf[offset + i] === b);
const ascii = (buf, from, to) => buf.subarray(from, to).toString('latin1');
const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1']);

/** True when the first bytes of the file match what its extension claims. */
export function matchesSignature(ext, buf) {
  switch (ext) {
    case '.jpg':
    case '.jpeg': return startsWith(buf, [0xff, 0xd8, 0xff]);
    case '.png':  return startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case '.webp': return ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP';
    case '.pdf':  return ascii(buf, 0, 1024).includes('%PDF');
    case '.xlsx':
    case '.docx': return startsWith(buf, [0x50, 0x4b, 0x03, 0x04]);
    case '.heic': return ascii(buf, 4, 8) === 'ftyp' && HEIC_BRANDS.has(ascii(buf, 8, 12));
    default:      return false;
  }
}

function filesOf(req) {
  if (!req.files) return [];
  return Array.isArray(req.files) ? req.files : Object.values(req.files).flat();
}

function readHead(filePath, length = 2048) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(length);
    const n = fs.readSync(fd, buf, 0, length, 0);
    return buf.subarray(0, n);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Runs after multer. Checks every stored file against its extension's signature;
 * on the first mismatch deletes ALL of the request's files and answers 415 naming it.
 * Stricter than the declared type against a renamed executable, tolerant of honest clients.
 */
export function verifyUploadedFiles(req, res, next) {
  const files = filesOf(req);
  for (const file of files) {
    const ext = path.extname(file.originalname).toLowerCase();
    let ok = false;
    let detected = 'unreadable';
    try {
      const head = readHead(file.path);
      ok = matchesSignature(ext, head);
      detected = `bytes ${head.subarray(0, 4).toString('hex')}`;
    } catch { /* unreadable: treated as a mismatch */ }
    if (!ok) {
      logger.warn('upload rejected', {
        requestId: req.id, route: req.originalUrl?.split('?')[0], code: 'UNSUPPORTED_FILE_TYPE',
        reason: 'content does not match extension', extension: ext, declaredType: file.mimetype,
        detectedType: detected, size: file.size,
      });
      for (const f of files) fs.rmSync(f.path, { force: true });
      return next(unsupported(`File content does not match its type: ${file.originalname}.`));
    }
  }
  return next();
}

const multerInstance = multer({
  storage,
  fileFilter,
  limits: { fileSize: 30 * 1024 * 1024 },
  defParamCharset: 'utf8', // browsers send file names as UTF-8; multer's default (latin1) garbles Hindi names
});

// A rejected or failed upload must not leave temp files behind.
const withCleanup = (mw) => (req, res, next) => mw(req, res, (err) => {
  if (err) for (const f of filesOf(req)) fs.rmSync(f.path, { force: true });
  next(err);
});

/** Use these in routes: multer, then the signature check. */
export const uploadArray = (field, max) => [withCleanup(multerInstance.array(field, max)), verifyUploadedFiles];
export const uploadFields = (fields) => [withCleanup(multerInstance.fields(fields)), verifyUploadedFiles];
