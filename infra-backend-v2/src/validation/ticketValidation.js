// ============================================================
//  RAISE-TICKET VALIDATION (plan.md §4 Phase 3 item 4)
//
//  Strict backend validation for the new campus/building/landmark/category/
//  contact_phone fields, enforced with zod BEFORE any database
//  transaction begins. multer parses multipart fields as strings, so
//  numeric/optional fields are pre-processed here rather than trusted as
//  already-typed.
// ============================================================
import { z } from 'zod';
import { CATEGORY_RULES } from '../config/ticketCategories.js';

const CAMPUS_VALUES = ['NORTH', 'SOUTH'];
const DEPARTMENT_VALUES = ['Civil', 'Electrical', 'Horticulture'];
const TYPE_VALUES = ['recurring', 'non-recurring'];

// multer/form fields arrive as '' when a text input is left empty -- treat
// blank the same as absent so `.optional()` actually applies.
const blankToUndefined = (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const optionalString = (max) =>
  z.preprocess(blankToUndefined, z.string().trim().max(max).optional());

const optionalCoordinate = (min, max) =>
  z.preprocess(
    (v) => (blankToUndefined(v) === undefined ? undefined : Number(v)),
    z.number().min(min).max(max).optional()
  );

export const createTicketSchema = z.object({
  title: optionalString(255),
  department: z.enum(DEPARTMENT_VALUES),
  description: z.string().trim().min(1, 'description is required').max(10000),
  type: z.preprocess(blankToUndefined, z.enum(TYPE_VALUES).optional()).default('recurring'),

  campus: z.enum(CAMPUS_VALUES),
  building: optionalString(150),
  landmark: z.string().trim().min(1, 'landmark is required').max(255),
  lat: optionalCoordinate(-90, 90),
  lng: optionalCoordinate(-180, 180),
  category: z.string().trim().min(1, 'category is required').max(50),
  contact_phone: z
    .string()
    .trim()
    .regex(/^[0-9+\-\s()]{7,20}$/, 'contact_phone must be a valid phone number'),
}).superRefine((data, ctx) => {
  // A category can force department and/or campus; a submission that
  // disagrees is rejected, not silently rewritten.
  const rule = CATEGORY_RULES.get(data.category);
  if (!rule) return;
  for (const field of ['department', 'campus']) {
    if (rule[field] && data[field] !== rule[field]) {
      ctx.addIssue({
        code: 'custom',
        path: [field],
        message: `category_scope_mismatch: "${data.category}" requires ${field} ${rule[field]}`,
      });
    }
  }
});

/** Flattens a ZodError into a stable, small shape for the HTTP response. */
export function formatZodIssues(zodError) {
  return zodError.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}
