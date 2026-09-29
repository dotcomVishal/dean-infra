// GET /api/attachments/:id — the ONLY way to read an uploaded file (S2).
// Every request is authenticated (router-level requireAuth), then passed
// through the visibility matrix (services/visibility.js) before a byte is sent.
// Anything the viewer may not see answers 404, exactly like a missing id, so
// ids cannot be probed.
import path from 'path';
import pool from '../config/db.js';
import { loadViewer, canViewAttachment } from '../services/visibility.js';
import { sendServerError } from '../utils/httpError.js';

const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads');

// Served type comes from OUR extension table, never from what the uploader claimed.
const INLINE_TYPES = Object.freeze({
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.heic': 'image/heic',
});
const DOWNLOAD_TYPES = Object.freeze({
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
});

const notFound = (res) => res.status(404).json({ success: false, message: 'Attachment not found' });

export const downloadAttachment = async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0 || String(id) !== req.params.id) return notFound(res);

  try {
    const [rows] = await pool.query(
      `SELECT a.id, a.file_url, a.document_category, a.uploaded_by, u.role AS uploader_role,
              t.id AS ticket_id, t.applicant_id, t.assigned_je_id, t.current_desk_user_id,
              t.department, t.campus, t.status
         FROM attachments a
         JOIN tickets t ON t.id = a.ticket_id
         LEFT JOIN users u ON u.id = a.uploaded_by
        WHERE a.id = ?`,
      [id]
    );
    if (rows.length === 0) return notFound(res);
    const att = rows[0];

    const ticket = { ...att, id: att.ticket_id };
    const viewer = await loadViewer(pool, req.user, ticket);
    if (!canViewAttachment(viewer, ticket, att)) return notFound(res);

    // file_url is "/uploads/tickets/<id>/<folder>/<file>". Resolve it under the
    // upload root and refuse anything that escapes it (defence in depth: the
    // column is server-written, but a path is only trusted after this check).
    const relative = String(att.file_url).replace(/^\/?uploads\//, '');
    const absolute = path.resolve(UPLOAD_ROOT, relative);
    if (!absolute.startsWith(UPLOAD_ROOT + path.sep)) return notFound(res);

    const ext = path.extname(absolute).toLowerCase();
    const inline = INLINE_TYPES[ext];
    const contentType = inline ?? DOWNLOAD_TYPES[ext];
    if (!contentType) return notFound(res); // legacy file outside the allow-list: never served

    const fileName = path.basename(absolute).replace(/^\d+-\d+-/, '').replace(/[^\w.\- ]/g, '_');
    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'private, no-store'); // shared PCs: nothing lingers (S14)
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");

    res.sendFile(absolute, { dotfiles: 'deny', cacheControl: false, lastModified: false }, (err) => {
      if (err && !res.headersSent) notFound(res);
    });
  } catch (error) {
    return sendServerError(req, res, error, 'downloadAttachment error');
  }
};
