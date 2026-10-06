// The two SQL fragments that used to be copy-pasted into five queries: the
// latest report per ticket (the JE's estimate) and the awarded tender per ticket.
//
//   effective amount = the award amount when there is one, else the latest estimate.
//
// Usage:  FROM mnt_tickets t
//           LEFT JOIN ${LATEST_REPORT} r  ON r.ticket_id  = t.id
//           LEFT JOIN ${AWARDED_TENDER} aw ON aw.ticket_id = t.id
// and select EFFECTIVE_AMOUNT where a single per-ticket figure is wanted.

export const LATEST_REPORT = `(
  SELECT r1.* FROM mnt_reports r1
  JOIN (SELECT ticket_id, MAX(id) AS max_id FROM mnt_reports GROUP BY ticket_id) r2 ON r1.id = r2.max_id
)`;

export const AWARDED_TENDER = `(
  SELECT tn1.* FROM mnt_tenders tn1
  JOIN (SELECT ticket_id, MAX(id) AS max_id FROM mnt_tenders WHERE status = 'AWARDED' GROUP BY ticket_id) tn2
    ON tn1.id = tn2.max_id
)`;

export const EFFECTIVE_AMOUNT = 'COALESCE(aw.work_order_value, r.estimated_amount)';
