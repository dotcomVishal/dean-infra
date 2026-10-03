import fs from 'fs';
import path from 'path';

/** Root of all stored files. UPLOADS_DIR lets tests use a throwaway folder; read at call time. */
export const uploadRoot = () => path.resolve(process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads'));

export const moveFile = async (file, ticketId, subFolder) => {
  const folder = subFolder || 'applicant_evidence';
  const ticketDir = path.join(uploadRoot(), 'tickets', String(ticketId), folder);

  if (!fs.existsSync(ticketDir)) {
    fs.mkdirSync(ticketDir, { recursive: true });
  }

  const newPath = path.join(ticketDir, file.filename);
  try {
    await fs.promises.rename(file.path, newPath);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err; // temp and final folders on different file systems
    await fs.promises.copyFile(file.path, newPath);
    await fs.promises.unlink(file.path);
  }
  file.path = newPath; // so cleanupTempFiles removes it if the txn rolls back

  return `/uploads/tickets/${ticketId}/${folder}/${file.filename}`;
};

/** Display name and size to store next to a file: no path characters, at most 255 characters. */
export const fileMeta = (file) => ({
  originalName: String(file?.originalname ?? '')
    .replace(/[\\/\u0000-\u001f]/g, '_').trim().slice(0, 255) || null,
  sizeBytes: Number.isInteger(file?.size) ? file.size : null,
});

export const cleanupTempFiles = (files) => {
  if (!files) return;

  const fileArray = Array.isArray(files) ? files : Object.values(files).flat();
  fileArray.forEach((file) => {
    if (file?.path && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
  });
};

/** Upper bound on files per ticket, on top of 10 per request and 30 MB each. */
export const MAX_FILES_PER_TICKET = 60;

// Folder under uploads/tickets/<id>/ for each category.
export const FOLDER_FOR_CATEGORY = Object.freeze({
  APPLICANT_EVIDENCE: 'applicant_evidence',
  JE_SITE_PHOTO: 'je_reports/site_photos',
  JE_ESTIMATE_DOC: 'je_reports/estimate_docs',
  DESK_DOC: 'desk_docs',
  WORK_DOC: 'work_docs',
});

/**
 * The one place files are moved into place and recorded. Runs inside the caller's transaction:
 * if that rolls back, `file.path` already points at the moved file, so `cleanupTempFiles` removes it.
 *
 * @param category  a category name, or a function (file) => category when one request mixes kinds
 * @param desk      the desk the person acted as (APPLICANT, JE, AE, SE, DEAN, DIRECTOR, SYSADMIN),
 *                  stored because a post can change later and the record must say what was true then
 * @param auditLogId the movement the files travelled with (null for none)
 * @returns ids of the new infra_attachments rows
 */
export async function storeAttachments(connection, {
  ticketId, files, userId, category, desk, auditLogId = null, reportId = null,
}) {
  const categoryOf = typeof category === 'function' ? category : () => category;
  const ids = [];
  for (const file of files) {
    const cat = categoryOf(file);
    const fileUrl = await moveFile(file, ticketId, FOLDER_FOR_CATEGORY[cat]);
    const { originalName, sizeBytes } = fileMeta(file);
    const [r] = await connection.query(
      `INSERT INTO infra_attachments
         (ticket_id, report_id, file_url, original_name, size_bytes, uploaded_by, uploader_desk, audit_log_id, document_category)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ticketId, reportId, fileUrl, originalName, sizeBytes, userId, desk, auditLogId, cat]
    );
    ids.push(r.insertId);
  }
  return ids;
}
