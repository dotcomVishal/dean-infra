// "Act as" for Sysadmin mock testing (plan2.md F5).
//
// A Sysadmin sends `X-Test-Role: <ROLE>` on a request for a MOCK ticket and the
// request then runs with that effective role, through the real routes, the real
// state machine and the real visibility code. The header never widens access to
// real tickets. Fails closed:
//   * header absent                                   -> no-op
//   * MOCK_TESTING_ENABLED=false                      -> 403
//   * real role is not SYSADMIN (or is a demo account) -> 403
//   * unknown role in the header                      -> 400
//   * ticket missing, not is_mock, or a demo ticket   -> 403
//   * header on a route with no ticket id (queue,     -> 400
//     desk, create, ...)
// Every audit row is still written under the real Sysadmin's user id.
import pool from '../config/db.js';

export const TEST_ROLE_HEADER = 'x-test-role';
export const TEST_ROLES = Object.freeze([
  'APPLICANT', 'JE', 'AE', 'SE', 'DEAN', 'DIRECTOR', 'CLERICAL', 'ACCOUNTANT',
]);

/** Kill switch. Default ON; only the literal string 'false' turns it off. */
export const mockTestingEnabled = () => process.env.MOCK_TESTING_ENABLED !== 'false';

const wantedRole = (req) => {
  const raw = req.headers[TEST_ROLE_HEADER];
  return raw === undefined ? null : String(raw).trim().toUpperCase();
};

const deny = (res, status, message) => res.status(status).json({ success: false, message });

/** Prefix for audit remarks written while acting as another role. '' outside test mode. */
export const testPrefix = (req) => (req.realUser ? `[TEST as ${req.user.role}] ` : '');

async function apply(req, res, next, mockLookupSql, id) {
  const role = wantedRole(req);
  if (role === null) return next();

  if (!mockTestingEnabled()) return deny(res, 403, 'Test mode is disabled.');
  const real = req.realUser ?? req.user;
  if (!real || real.role !== 'SYSADMIN' || real.is_demo) return deny(res, 403, 'Test mode is for the Sysadmin only.');
  if (!TEST_ROLES.includes(role)) return deny(res, 400, `X-Test-Role must be one of ${TEST_ROLES.join(', ')}.`);

  try {
    const [rows] = await pool.query(mockLookupSql, [id]);
    if (rows.length === 0 || !rows[0].is_mock) return deny(res, 403, 'Test mode only works on test tickets.');
  } catch (err) {
    return next(err);
  }
  req.realUser = real;
  req.user = { ...real, role, isTest: true };
  return next();
}

/** router.param('ticket_id', ...) handler. */
export const testRoleForTicketParam = (req, res, next, ticketId) =>
  apply(req, res, next, 'SELECT (is_mock AND NOT is_demo) AS is_mock FROM tickets WHERE id = ?', ticketId);

/** router.param('id', ...) handler for /api/attachments/:id (the ticket comes from the attachment). */
export const testRoleForAttachmentParam = (req, res, next, attachmentId) =>
  apply(req, res, next,
    'SELECT (t.is_mock AND NOT t.is_demo) AS is_mock FROM attachments a JOIN tickets t ON t.id = a.ticket_id WHERE a.id = ?', attachmentId);

/** Router-level guard: the header is only meaningful under /:ticket_id/... */
export const rejectStrayTestRole = (req, res, next) => {
  if (wantedRole(req) !== null && !/^\/\d+(\/|$)/.test(req.path)) {
    return deny(res, 400, 'X-Test-Role is only accepted on a single test ticket.');
  }
  return next();
};

/** Guard for the admin test-ticket endpoints: 404 when the kill switch is off. */
export const requireMockTesting = (_req, res, next) =>
  (mockTestingEnabled() ? next() : deny(res, 404, 'Not found'));
