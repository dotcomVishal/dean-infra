import path from 'path';
import { fileURLToPath } from 'url';

// X3: one upload root for multer, fileManager, the download route and the admin
// delete. Anchored to this file, not process.cwd(), so it is the same wherever
// the process starts.
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const UPLOAD_ROOT = path.join(backendRoot, 'uploads');
export const TEMP_DIR = path.join(UPLOAD_ROOT, 'temp');
export const TICKETS_DIR = path.join(UPLOAD_ROOT, 'tickets');
export const TRASH_DIR = path.join(UPLOAD_ROOT, 'trash');
