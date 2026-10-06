// Schema fingerprint: prints one sorted line per column, index column, foreign
// key and view of the connected database. Two databases with the same schema
// give the same output, so `diff` proves it.
//
//   node scripts/schema-fingerprint.mjs [prefix ...]      fingerprint on stdout
//   node scripts/schema-fingerprint.mjs --check           compare core_ + mnt_ objects
//                                                         with migrations/expected-schema.txt
//
// Standard output carries the fingerprint and nothing else. Logs go to
// standard error. This file never imports src/config/db.js (no pool).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { buildConnectionOptions } from '../src/config/dbOptions.js';

dotenv.config({ quiet: true });

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_FILE = path.join(root, 'migrations', 'expected-schema.txt');
const CHECK_PREFIXES = ['core_', 'mnt_'];

const args = process.argv.slice(2);
const check = args.includes('--check');
const prefixes = check ? CHECK_PREFIXES : args.filter((a) => !a.startsWith('--'));

const wanted = (name) => prefixes.length === 0 || prefixes.some((p) => name.startsWith(p));

async function fingerprint(conn, dbName) {
  const lines = [];
  const q = async (sql) => (await conn.query(sql, [dbName]))[0];

  for (const c of await q(
    `SELECT TABLE_NAME t, ORDINAL_POSITION p, COLUMN_NAME n, COLUMN_TYPE ty, IS_NULLABLE nl,
            COLUMN_DEFAULT d, COLLATION_NAME co, EXTRA ex
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?`)) {
    if (!wanted(c.t)) continue;
    lines.push(`COLUMN ${c.t} ${String(c.p).padStart(3, '0')} ${c.n} ${c.ty} null=${c.nl} default=${c.d ?? 'NULL'} collation=${c.co ?? '-'} extra=${c.ex}`);
  }

  for (const i of await q(
    `SELECT TABLE_NAME t, INDEX_NAME n, SEQ_IN_INDEX s, COLUMN_NAME c, NON_UNIQUE u
       FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ?`)) {
    if (!wanted(i.t)) continue;
    lines.push(`INDEX ${i.t} ${i.n} ${i.s} ${i.c} unique=${i.u ? 0 : 1}`);
  }

  for (const f of await q(
    `SELECT k.TABLE_NAME t, k.CONSTRAINT_NAME n, k.ORDINAL_POSITION s, k.COLUMN_NAME c,
            k.REFERENCED_TABLE_NAME rt, k.REFERENCED_COLUMN_NAME rc, r.DELETE_RULE dr, r.UPDATE_RULE ur
       FROM information_schema.KEY_COLUMN_USAGE k
       JOIN information_schema.REFERENTIAL_CONSTRAINTS r
         ON r.CONSTRAINT_SCHEMA = k.TABLE_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME
      WHERE k.TABLE_SCHEMA = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL`)) {
    if (!wanted(f.t)) continue;
    lines.push(`FK ${f.n} ${f.t}.${f.c} -> ${f.rt}.${f.rc} on_delete=${f.dr} on_update=${f.ur} pos=${f.s}`);
  }

  for (const t of await q(
    `SELECT TABLE_NAME t, TABLE_TYPE ty, ENGINE e, TABLE_COLLATION co
       FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?`)) {
    if (!wanted(t.t)) continue;
    lines.push(`OBJECT ${t.t} ${t.ty} engine=${t.e ?? '-'} collation=${t.co ?? '-'}`);
  }

  for (const v of await q(
    `SELECT TABLE_NAME t, VIEW_DEFINITION d, SECURITY_TYPE s FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ?`)) {
    if (!wanted(v.t)) continue;
    // Strip the database name so two databases with different names compare equal.
    const def = String(v.d).split(`\`${dbName}\`.`).join('');
    lines.push(`VIEW ${v.t} security=${v.s} ${def}`);
  }

  return lines.sort();
}

const conn = await mysql.createConnection(buildConnectionOptions());
try {
  const [[{ db }]] = await conn.query('SELECT DATABASE() AS db');
  const lines = await fingerprint(conn, db);

  if (!check) {
    process.stdout.write(lines.join('\n') + '\n');
  } else {
    if (!fs.existsSync(EXPECTED_FILE)) {
      console.error(`schema check: ${EXPECTED_FILE} is missing`);
      process.exitCode = 1;
    } else {
      const expected = fs.readFileSync(EXPECTED_FILE, 'utf8').split('\n').filter(Boolean).sort();
      const got = new Set(lines);
      const want = new Set(expected);
      const missing = expected.filter((l) => !got.has(l));
      const extra = lines.filter((l) => !want.has(l));
      if (missing.length === 0 && extra.length === 0) {
        console.log('schema OK');
      } else {
        for (const l of missing) console.log(`- ${l}`);
        for (const l of extra) console.log(`+ ${l}`);
        console.error('schema check: database differs from migrations/expected-schema.txt ("-" expected, "+" found)');
        process.exitCode = 1;
      }
    }
  }
} finally {
  await conn.end();
}
