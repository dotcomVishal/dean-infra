import fs from 'fs';
import path from 'path';

export const moveFile = async (file, ticketId, subFolder) => {
  const folder = subFolder || 'applicant_evidence';
  const ticketDir = path.join(process.cwd(), 'uploads', 'tickets', String(ticketId), folder);

  if (!fs.existsSync(ticketDir)) {
    fs.mkdirSync(ticketDir, { recursive: true });
  }

  const newPath = path.join(ticketDir, file.filename);
  await fs.promises.rename(file.path, newPath);

  return `/uploads/tickets/${ticketId}/${folder}/${file.filename}`;
};

export const cleanupTempFiles = (files) => {
  if (!files) return;

  const fileArray = Array.isArray(files) ? files : Object.values(files).flat();
  fileArray.forEach((file) => {
    if (file?.path && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
  });
};
