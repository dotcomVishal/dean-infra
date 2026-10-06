// The one place a file moves from uploads/temp into a ticket folder and gets its
// attachments row. createTicket, submitReport, desk actions and the standalone
// upload all call it, so every file is recorded the same way: who (desk), when,
// and which movement it travelled with.
import { moveFile } from '../utils/fileManager.js';

// Folder under uploads/tickets/<id>/ per category.
export const UPLOAD_FOLDER = Object.freeze({
  APPLICANT_EVIDENCE: 'applicant_evidence',
  JE_SITE_PHOTO: 'je_reports/site_photos',
  JE_ESTIMATE_DOC: 'je_reports/estimate_docs',
  WORK_DOC: 'work_docs',
  DESK_DOC: 'desk_docs',
  AUTHORITY_REMARKS: 'authority_docs',
  CLERK_TENDER_DOC: 'tender_docs',
  FINANCE_SANCTION: 'finance_docs',
});

/**
 * Moves `files` into the ticket folder and inserts one attachments row each.
 * Runs inside the caller's transaction: on a later failure the caller rolls back
 * and calls cleanupTempFiles(files), which also removes files already moved
 * (moveFile updates file.path).
 *
 * @param {object} p
 * @param {string} p.desk   desk/role the uploader acted as (APPLICANT, JE, AE, ... SYSADMIN)
 * @returns {Promise<number[]>} attachment ids, in file order
 */
export async function attachFiles(connection, {
  ticketId, files, userId, desk, category, folder = UPLOAD_FOLDER[category], auditLogId = null, reportId = null,
}) {
  const ids = [];
  for (const file of files ?? []) {
    const fileUrl = await moveFile(file, ticketId, folder);
    const [result] = await connection.query(
      `INSERT INTO mnt_attachments
         (ticket_id, file_url, uploaded_by, document_category, report_id, uploader_desk, audit_log_id, original_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [ticketId, fileUrl, userId, category, reportId, desk, auditLogId, String(file.originalname ?? '').slice(0, 255) || null]
    );
    ids.push(result.insertId);
  }
  return ids;
}
