// Shared by the layout and the mail files. No imports from services/, so nothing here can loop back.
export const SIGNATURE = 'Deanery of Infrastructure, IIT Mandi';
export const FOOTER = 'This is an automated message from the Infrastructure portal. Please use the portal for any follow-up on this ticket.';

export const portalUrl = () => process.env.FRONTEND_URL || 'http://localhost:5173';
export const ticketRef = (id) => `TKT-${String(id).padStart(4, '0')}`;
export const ticketLink = (id) => `${portalUrl()}/ticket/${id}`;

/** One line, at most `max` characters. */
export const oneLine = (text, max) => {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};
