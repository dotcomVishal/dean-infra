// ============================================================
//  TICKET CATEGORIES (legacy Help Topics) + category-aware routing.
//
//  Data lives in ticketCategories.json (order = dropdown order). The same file
//  is duplicated in infra-frontend/src/config; a unit test keeps them equal.
//  A rule maps a category to a (department, campus) scope, never to a person:
//  who covers a scope is owned by user_scopes.
//    department / campus  null = use what the applicant picked, else forced.
//    manualJe             true = skip the JE pick; ticket goes UNASSIGNED to the AE.
// ============================================================
import fs from 'node:fs';

const DEPARTMENTS = ['Civil', 'Electrical', 'Horticulture'];
const CAMPUSES = ['NORTH', 'SOUTH'];

const rows = JSON.parse(
  fs.readFileSync(new URL('./ticketCategories.json', import.meta.url), 'utf8')
);

// A bad data file fails at boot and in unit tests, never in a live request.
{
  const seen = new Set();
  for (const r of rows) {
    if (typeof r.name !== 'string' || r.name.length === 0 || r.name.length > 50) {
      throw new Error(`ticketCategories.json: bad name ${JSON.stringify(r.name)}`);
    }
    if (seen.has(r.name)) throw new Error(`ticketCategories.json: duplicate "${r.name}"`);
    seen.add(r.name);
    if (r.department !== null && !DEPARTMENTS.includes(r.department)) {
      throw new Error(`ticketCategories.json: bad department for "${r.name}"`);
    }
    if (r.campus !== null && !CAMPUSES.includes(r.campus)) {
      throw new Error(`ticketCategories.json: bad campus for "${r.name}"`);
    }
    if (typeof r.manualJe !== 'boolean') {
      throw new Error(`ticketCategories.json: manualJe must be boolean for "${r.name}"`);
    }
  }
}

export const TICKET_CATEGORIES = rows.map((r) => r.name);

export const CATEGORY_RULES = new Map(
  rows.map((r) => [r.name, { department: r.department, campus: r.campus, manualJe: r.manualJe }])
);

/** Routing for a submitted ticket: forced values applied over the applicant's choice. */
export function resolveRouting({ category, department, campus }) {
  const rule = CATEGORY_RULES.get(category);
  if (!rule) return { department, campus, manualJe: false };
  return {
    department: rule.department ?? department,
    campus: rule.campus ?? campus,
    manualJe: rule.manualJe,
  };
}

export const isManualJeCategory = (name) => CATEGORY_RULES.get(name)?.manualJe === true;
