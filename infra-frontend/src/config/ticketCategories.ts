import rawCategories from './ticketCategories.json';

export type CategoryDepartment = 'Civil' | 'Electrical' | 'Horticulture';
export type CategoryCampus = 'NORTH' | 'SOUTH';

export interface TicketCategory {
  name: string;
  department: CategoryDepartment | null;
  campus: CategoryCampus | null;
  manualJe: boolean;
}

// Same file as infra-backend-v2/src/config/ticketCategories.json (a backend
// unit test keeps them equal). null department/campus = applicant's choice.
export const TICKET_CATEGORIES = rawCategories as ReadonlyArray<TicketCategory>;

export const findCategory = (name: string): TicketCategory | undefined =>
  TICKET_CATEGORIES.find((c) => c.name === name);
