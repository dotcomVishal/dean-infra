// CSV for the Sysadmin export. UTF-8 with a BOM (Excel opens Hindi names correctly), CRLF line ends,
// RFC 4180 quoting, and a guard against formula injection: a text cell that a spreadsheet could read as a
// formula (starts with = + - @ tab or CR) gets a leading apostrophe. Numbers are written as they are.
export const BOM = '﻿';
export const CRLF = '\r\n';

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvRow = (cells) => cells.map(csvCell).join(',') + CRLF;
