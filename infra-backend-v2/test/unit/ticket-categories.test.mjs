// Category dropdown data, routing rules and the raise-ticket schema check.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TICKET_CATEGORIES, CATEGORY_RULES, resolveRouting, isManualJeCategory } from '../../src/config/ticketCategories.js';
import { createTicketSchema } from '../../src/validation/ticketValidation.js';

// Acceptance oracle: the exact dropdown order from the requirement.
const EXPECTED = [
  'All Mess', 'Beas Kund', 'Carpentry Work', 'Chandra Taal Hostel', 'Classrooms - North Campus',
  'Classrooms - South Campus', 'Cultural Affairs', 'Dashir', 'Existing Sport Facility',
  'Finance & Accounts', 'Gauri Kund', 'General Affairs', 'Horticulture Maintenance in Campus',
  'Hostel Affairs', 'Housekeeping', 'Institute Carriage Vehicle', 'Literary Affairs',
  'Maintenance Civil - North Campus', 'Maintenance Civil - South Campus',
  'Maintenance Electrical - Garpha', 'Maintenance Electrical - North Campus',
  'Maintenance Electrical - South Campus', 'Manimahesh', 'Masonry Work', 'Nako Hostel',
  'New Facility', 'New Requests for Hostels', 'Other', 'Painting Work', 'Plumbing Work',
  'Prashar Hostel', 'Renuka Hostel', 'Research Affairs', 'Security Unit', 'Sports Affairs',
  'Store and Purchase', 'Student Gymkhana', 'Support', 'Suraj Taal', 'Suvalsar Hostel',
  'Technical Affairs', 'Waste Management',
];

const MANUAL_JE = [
  'Beas Kund', 'Chandra Taal Hostel', 'Dashir', 'Gauri Kund', 'Manimahesh', 'Nako Hostel',
  'Prashar Hostel', 'Renuka Hostel', 'Suraj Taal', 'Suvalsar Hostel',
  'Maintenance Electrical - Garpha', 'Housekeeping', 'Waste Management',
];

test('category list is the 42 names in the required order', () => {
  assert.deepEqual(TICKET_CATEGORIES, EXPECTED);
  assert.equal(new Set(TICKET_CATEGORIES).size, 42);
  assert.ok(TICKET_CATEGORIES.every((n) => n.length <= 50));
});

test('every rule has a valid department, campus and boolean manualJe', () => {
  for (const [name, r] of CATEGORY_RULES) {
    assert.ok([null, 'Civil', 'Electrical', 'Horticulture'].includes(r.department), name);
    assert.ok([null, 'NORTH', 'SOUTH'].includes(r.campus), name);
    assert.equal(typeof r.manualJe, 'boolean', name);
  }
});

test('exactly the 13 agreed categories are manualJe', () => {
  const actual = TICKET_CATEGORIES.filter(isManualJeCategory);
  assert.deepEqual([...actual].sort(), [...MANUAL_JE].sort());
});

test('frontend category file equals the backend file', (t) => {
  const front = new URL('../../../infra-frontend/src/config/ticketCategories.json', import.meta.url);
  if (!fs.existsSync(front)) {
    if (process.env.CI) assert.fail('frontend ticketCategories.json missing in CI');
    return t.skip('frontend package not present');
  }
  const back = new URL('../../src/config/ticketCategories.json', import.meta.url);
  assert.deepEqual(JSON.parse(fs.readFileSync(front, 'utf8')), JSON.parse(fs.readFileSync(back, 'utf8')));
});

test('resolveRouting applies forced values and keeps the rest', () => {
  const pick = { department: 'Electrical', campus: 'NORTH' };
  assert.deepEqual(
    resolveRouting({ category: 'Maintenance Civil - South Campus', ...pick }),
    { department: 'Civil', campus: 'SOUTH', manualJe: false });
  assert.deepEqual(
    resolveRouting({ category: 'Carpentry Work', ...pick }),
    { department: 'Civil', campus: 'NORTH', manualJe: false });
  assert.deepEqual(
    resolveRouting({ category: 'Other', ...pick }),
    { ...pick, manualJe: false });
  assert.deepEqual(
    resolveRouting({ category: 'Maintenance Electrical - Garpha', department: 'Electrical', campus: 'SOUTH' }),
    { department: 'Electrical', campus: 'SOUTH', manualJe: true });
  assert.deepEqual(
    resolveRouting({ category: 'plumbing', ...pick }),
    { ...pick, manualJe: false });
});

const base = {
  department: 'Civil', campus: 'NORTH', description: 'x', landmark: 'gate', contact_phone: '9999999999',
};
const failsOn = (input, path) => {
  const r = createTicketSchema.safeParse(input);
  return !r.success && r.error.issues.some((i) => i.path.join('.') === path);
};

test('schema: matching category passes, free text still passes in Release 1', () => {
  assert.ok(createTicketSchema.safeParse({ ...base, category: 'Maintenance Civil - North Campus' }).success);
  assert.ok(createTicketSchema.safeParse({ ...base, category: 'Finance & Accounts' }).success);
  assert.ok(createTicketSchema.safeParse({ ...base, category: 'plumbing' }).success);
});

test('schema: category that contradicts department or campus is rejected', () => {
  assert.ok(failsOn({ ...base, category: 'Maintenance Electrical - North Campus' }, 'department'));
  assert.ok(failsOn({ ...base, category: 'Maintenance Civil - North Campus', campus: 'SOUTH' }, 'campus'));
  assert.ok(failsOn({ ...base, category: 'Horticulture Maintenance in Campus' }, 'department'));
});
