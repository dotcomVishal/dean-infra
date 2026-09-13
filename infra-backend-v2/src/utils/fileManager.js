import fs from 'fs';
import path from 'path';

export const organizeTicketFiles = (filesArray, ticketId, subFolder) => {
  if (!filesArray || filesArray.length === 0) return [];

  const targetDir = path.join(process.cwd(), `uploads/tickets/${ticketId}/${subFolder}`);
  
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  return filesArray.map(file => {
    const oldPath = file.path; 
    const newPath = path.join(targetDir, file.filename);

    fs.renameSync(oldPath, newPath);

    return `/uploads/tickets/${ticketId}/${subFolder}/${file.filename}`;
  });
};

export const cleanupTempFiles = (files) => {
  if (!files) return;
  
  // Handle both single arrays (upload.array) and object arrays (upload.fields)
  const fileArray = Array.isArray(files) ? files : Object.values(files).flat();
  
  fileArray.forEach(file => {
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
  });
};