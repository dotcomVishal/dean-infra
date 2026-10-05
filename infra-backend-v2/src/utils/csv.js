// RFC 4180 CSV for the Sysadmin export. UTF-8 with a BOM so Excel opens it correctly.
//
// Formula-injection guard: ticket titles and descriptions are user input. A cell
// that starts with = + - @ tab or carriage return would run as a formula in Excel,
// so a string cell like that is prefixed with an apostrophe. Numbers are never guarded.

export const CSV_BOM = '﻿';

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'number' ? String(value) : String(value);
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const csvRow = (values) => `${values.map(csvCell).join(',')}\r\n`;
