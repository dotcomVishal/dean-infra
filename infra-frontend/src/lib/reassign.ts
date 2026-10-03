export interface ReassignValue { desk: string; userId: string }
export const NO_REASSIGN: ReassignValue = { desk: '', userId: '' };

/** Request body part for POST /admin/tickets/:id/override, or undefined when nothing is chosen. */
export const reassignBody = (v: ReassignValue) =>
  v.desk && v.userId ? { desk: v.desk, user_id: Number(v.userId) } : undefined;
