// Integration tests for services/assignment.js (plan.md §4 Phase 3
// acceptance: "unit tests for the selection function -- unavailable JE
// skipped, BOTH scope matched, tie broken by round robin, nobody available
// gives UNASSIGNED at the correct AE").
//
// Needs a live DB with migrations 001-004 applied and scripts/seed-staff.mjs
// already run (reads the real staffDetails.md roster + user_scopes).
// Cleans up every row it writes (leave entries, last_assigned_at) so it is
// safe to run against a shared dev database.
//
// Run with:
//   node scripts/test-assignment.mjs
import 'dotenv/config';
import '../src/config/requireTestDb.js';
import pool from '../src/config/db.js';
import { pickAvailableJe, assignTicket } from '../src/services/assignment.js';

let pass = 0, fail = 0;
const results = [];
async function ok(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    pass++;
  } catch (e) {
    console.log(`  FAIL  ${name}\n        ${e.message}`);
    fail++;
  }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

async function userId(email) {
  const [rows] = await pool.query('SELECT id FROM infra_users WHERE email = ?', [email]);
  if (rows.length === 0) throw new Error(`Fixture user not found: ${email} (run scripts/seed-staff.mjs first)`);
  return rows[0].id;
}

async function withLeave(userIdValue, fn) {
  const [result] = await pool.query(
    `INSERT INTO infra_user_availability (user_id, start_at, end_at, reason, created_by)
     VALUES (?, NOW() - INTERVAL 1 HOUR, NOW() + INTERVAL 1 DAY, 'test-assignment.mjs', ?)`,
    [userIdValue, userIdValue]
  );
  try {
    await fn();
  } finally {
    await pool.query('DELETE FROM infra_user_availability WHERE id = ?', [result.insertId]);
  }
}

async function resetLastAssigned(...emails) {
  for (const email of emails) {
    await pool.query('UPDATE infra_users SET last_assigned_at = NULL WHERE email = ?', [email]);
  }
}

async function run() {
  console.log('\n=== Fair Auto-Assignment Engine (services/assignment.js) ===');

  await ok('BOTH-scope JE matched for either campus: Horticulture/NORTH -> Munna Kumar', async () => {
    await resetLastAssigned('munna.kumar@campus.edu');
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const je = await pickAvailableJe(conn, { department: 'Horticulture', campus: 'NORTH' });
      await conn.rollback();
      eq(je?.email, 'munna.kumar@campus.edu', 'picked JE');
    } finally { conn.release(); }
  });

  await ok('BOTH-scope JE matched for either campus: Horticulture/SOUTH -> Munna Kumar', async () => {
    await resetLastAssigned('munna.kumar@campus.edu');
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const je = await pickAvailableJe(conn, { department: 'Horticulture', campus: 'SOUTH' });
      await conn.rollback();
      eq(je?.email, 'munna.kumar@campus.edu', 'picked JE');
    } finally { conn.release(); }
  });

  await ok('unavailable JE (on leave) is skipped', async () => {
    const kapilId = await userId('kapil.verma@campus.edu');
    await withLeave(kapilId, async () => {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const je = await pickAvailableJe(conn, { department: 'Electrical', campus: 'SOUTH' });
        await conn.rollback();
        eq(je, null, 'Kapil Verma is Electrical/SOUTH\'s only JE and is on leave');
      } finally { conn.release(); }
    });
  });

  await ok('nobody available -> UNASSIGNED at the correct (same-campus) AE, never the other campus', async () => {
    const deepakId = await userId('deepak.chauhan@campus.edu'); // Civil/NORTH's only JE
    await withLeave(deepakId, async () => {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const result = await assignTicket(conn, { department: 'Civil', campus: 'NORTH' });
        await conn.rollback();
        eq(result.status, 'UNASSIGNED', 'status');
        eq(result.deskUser.email, 'siddarth.jamwal@campus.edu', 'routed to the NORTH Civil AE, not the SOUTH one');
      } finally { conn.release(); }
    });
  });

  await ok('tie broken by round robin (lowest open count, then last_assigned_at, then id)', async () => {
    await resetLastAssigned('omjeet.thakur@campus.edu', 'gavin.dhiman@campus.edu');
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const first = await assignTicket(conn, { department: 'Civil', campus: 'SOUTH' });
      await conn.commit(); // commits last_assigned_at bump so the second pick sees it

      await conn.beginTransaction();
      const second = await assignTicket(conn, { department: 'Civil', campus: 'SOUTH' });
      await conn.commit();

      eq(first.deskUser.email, 'omjeet.thakur@campus.edu', 'first pick (both idle, id tiebreak)');
      eq(second.deskUser.email, 'gavin.dhiman@campus.edu', 'second pick rotates to the other JE');
    } finally {
      await resetLastAssigned('omjeet.thakur@campus.edu', 'gavin.dhiman@campus.edu');
      conn.release();
    }
  });

  await ok('SELECT ... FOR UPDATE SKIP LOCKED: concurrent picks land on different JEs', async () => {
    await resetLastAssigned('rishav.verma@campus.edu', 'yashpal.thakur@campus.edu', 'chirag.vaidya@campus.edu');
    const c1 = await pool.getConnection();
    const c2 = await pool.getConnection();
    try {
      await c1.beginTransaction();
      await c2.beginTransaction();
      const je1 = await pickAvailableJe(c1, { department: 'Electrical', campus: 'NORTH' });
      const je2 = await pickAvailableJe(c2, { department: 'Electrical', campus: 'NORTH' });
      if (!je1 || !je2) throw new Error('expected two available candidates in Electrical/NORTH');
      if (je1.id === je2.id) throw new Error(`both transactions picked the same JE (${je1.email}) -- race not prevented`);
    } finally {
      await c1.rollback();
      await c2.rollback();
      c1.release();
      c2.release();
    }
  });

  console.log(`\n${pass} passed, ${fail} failed.\n`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error('Fatal error running assignment tests:', e);
  process.exit(1);
});
