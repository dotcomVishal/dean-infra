// Demo sandbox (Agent/demo-plan.md, layer D): a demo account only ever reaches demo tickets.
// These are router.param handlers. They do nothing for a real user. For a demo user they look
// up the owning ticket and answer 404 unless it is a demo ticket, so a real id cannot be probed.
import pool from '../config/db.js';

const notFound = (res) => res.status(404).json({ success: false, message: 'Not found' });

async function guard(req, res, next, sql, id) {
  if (!req.user?.is_demo) return next();
  try {
    const [rows] = await pool.query(sql, [id]);
    if (rows.length === 0 || !rows[0].is_demo) return notFound(res);
  } catch (err) {
    return next(err);
  }
  return next();
}

export const demoTicketParam = (req, res, next, ticketId) =>
  guard(req, res, next, 'SELECT is_demo FROM tickets WHERE id = ?', ticketId);

export const demoAttachmentParam = (req, res, next, attachmentId) =>
  guard(req, res, next,
    'SELECT t.is_demo FROM attachments a JOIN tickets t ON t.id = a.ticket_id WHERE a.id = ?', attachmentId);

export const demoBillParam = (req, res, next, billId) =>
  guard(req, res, next,
    'SELECT t.is_demo FROM bills b JOIN tickets t ON t.id = b.ticket_id WHERE b.id = ?', billId);

// Layer F: the admin console for a demo account. Only the demo Sysadmin gets this far (requireRole),
// and only for these GET routes. Every other route and method answers 403.
const DEMO_ADMIN_READS = [
  /^\/metrics$/, /^\/tickets$/, /^\/tickets\/export$/, /^\/tickets\/[^/]+\/details$/, /^\/users$/, /^\/audit-logs$/,
];

export const demoAdminGuard = (req, res, next) => {
  if (!req.user?.is_demo) return next();
  if (req.method === 'GET' && DEMO_ADMIN_READS.some((re) => re.test(req.path))) return next();
  return res.status(403).json({ success: false, code: 'DEMO_READ_ONLY', message: 'Read-only in the demo.' });
};
