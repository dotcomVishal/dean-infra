import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Point to the uploads directory in the root folder (two levels up from this file)
const uploadDir = path.join(__dirname, '../../uploads');

// Ensure the uploads folder exists before trying to save to it
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Create a unique, URL-safe filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const sanitizedOriginal = file.originalname.replace(/\s+/g, '_');
    cb(null, `${uniqueSuffix}-${sanitizedOriginal}`);
  }
});

export const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 } // 30MB limit per file[cite: 2]
});