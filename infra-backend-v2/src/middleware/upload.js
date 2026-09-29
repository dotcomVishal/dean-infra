import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tempDir = path.join(__dirname, '../../uploads/temp');
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

// S3: allow-list, not block-list. Extension AND declared MIME type must both be
// on the list, so "x.html", "x.svg" or "x.jpg" sent as text/html are all refused.
// (Downloads are served with nosniff + attachment for non-images regardless.)
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

export function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED_UPLOADS[ext]?.includes(file.mimetype)) return cb(null, true);
  const err = new Error(`File type not allowed: ${file.originalname}. Allowed: ${Object.keys(ALLOWED_UPLOADS).join(', ')}.`);
  err.code = 'UNSUPPORTED_FILE_TYPE';
  cb(err);
}

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 30 * 1024 * 1024 }
});
