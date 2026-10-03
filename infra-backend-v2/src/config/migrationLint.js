// Destructive-statement scan for migration files. A file that contains one is
// refused unless it carries a reviewed marker: `-- destructive-ok: <reason>`.

const MARKER = /^\s*--\s*destructive-ok:\s*\S+/im;

const RULES = [
  [/\bDROP\s+DATABASE\b/i, 'DROP DATABASE'],
  [/\bDROP\s+SCHEMA\b/i, 'DROP SCHEMA'],
  [/\bDROP\s+TABLE\b/i, 'DROP TABLE'],
  [/\bTRUNCATE\b/i, 'TRUNCATE'],
  [/(^|;)\s*USE\s+\S/i, 'USE'],
  [/\bCREATE\s+DATABASE\b/i, 'CREATE DATABASE'],
];

/** Remove comments and string literals so words inside them never match. */
function stripNoise(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/(^|\n)\s*#[^\n]*/g, '$1')
    .replace(/'(?:[^'\\]|\\.|'')*'/g, "''")
    .replace(/"(?:[^"\\]|\\.|"")*"/g, '""');
}

/** @returns {{ok: boolean, found: string[], marked: boolean}} */
export function lintMigration(sql) {
  const clean = stripNoise(sql);
  const found = [];
  for (const [re, label] of RULES) if (re.test(clean)) found.push(label);
  for (const stmt of clean.split(';')) {
    if (/^\s*DELETE\s+FROM\b/i.test(stmt) && !/\bWHERE\b/i.test(stmt)) {
      found.push('DELETE FROM without WHERE');
      break;
    }
  }
  const marked = MARKER.test(sql);
  return { ok: found.length === 0 || marked, found, marked };
}
