// A deleted ticket is hidden, not removed (Master plan, section 9). Outside the Sysadmin routes it must be
// indistinguishable from a ticket that does not exist, so one param loader answers 404 for every
// /tickets/:ticket_id/... route and for /attachments/:id.
import pool from '../config/db.js';

const notFound = (res) => res.status(404).json({ success: false, message: 'Ticket not found' });

/** router.param('ticket_id', ...) handler. A non-numeric id is left to the route's own validation. */
export const hideDeletedTicketParam = async (req, res, next, ticketId) => {
  if (!/^\d+$/.test(String(ticketId))) return next();
  try {
    const [rows] = await pool.query('SELECT deleted_at FROM infra_tickets WHERE id = ?', [ticketId]);
    if (rows[0]?.deleted_at) return notFound(res);
    return next();
  } catch (err) {
    return next(err);
  }
};

/** router.param('id', ...) handler for /api/attachments/:id (the ticket comes from the attachment). */
export const hideDeletedAttachmentParam = async (req, res, next, attachmentId) => {
  if (!/^\d+$/.test(String(attachmentId))) return next();
  try {
    const [rows] = await pool.query(
      'SELECT t.deleted_at FROM infra_attachments a JOIN infra_tickets t ON t.id = a.ticket_id WHERE a.id = ?', [attachmentId]);
    if (rows[0]?.deleted_at) return res.status(404).json({ success: false, message: 'Attachment not found' });
    return next();
  } catch (err) {
    return next(err);
  }
};
