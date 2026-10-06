// Seeds the real 20-person construction-wing roster from staffDetails.md,
// plus two dummy Dean/Director accounts (Q7), replacing the fictional cast
// baked into schema.sql (D7: "real staff seed from staffDetails.md").
//
// Idempotent: run any number of times.
//   - Roster rows key on `email` (UNIQUE in the schema) via INSERT IGNORE,
//     so a row SYSADMIN has since edited (new email, new role, ...) is left
//     alone rather than reset.
//   - Dean/Director are singleton roles: this script checks "does a DEAN
//     (or DIRECTOR) already exist" before inserting the dummy, so once
//     SYSADMIN replaces the dummy through the sysadmin portal (any name,
//     any email), re-running this script will not insert a second one.
//
// Run with:
//   node scripts/seed-staff.mjs
import 'dotenv/config';
import pool from '../src/config/db.js';

// Campus values match the ENUM added in migrations/003 (NORTH, SOUTH, BOTH).
// Roles/departments/campus per plan.md §3.2, sourced from staffDetails.md.
const ROSTER = [
  // -- Superintending Engineer --------------------------------------------
  { name: 'Vijay Kumar Sharma', role: 'SE', department: 'Civil', campus: 'BOTH', phone: '9876500001' },

  // -- Assistant Engineers --------------------------------------------------
  { name: 'Siddarth Jamwal', role: 'AE', department: 'Civil', campus: 'NORTH', phone: '9876500002' },
  { name: 'Vikas Kumar Chaudhary', role: 'AE', department: 'Civil', campus: 'SOUTH', phone: '9876500003' },
  { name: 'Neeraj Chauhan', role: 'AE', department: 'Electrical', campus: 'BOTH', phone: '9876500004' },

  // -- Junior Engineers (Civil) ---------------------------------------------
  { name: 'Omjeet Thakur', role: 'JE', department: 'Civil', campus: 'SOUTH', phone: '9876500005' },
  { name: 'Gavin Dhiman', role: 'JE', department: 'Civil', campus: 'SOUTH', phone: '9876500006' },
  { name: 'Deepak Chauhan', role: 'JE', department: 'Civil', campus: 'NORTH', phone: '9876500007' },

  // -- Junior Engineers (Electrical) -----------------------------------------
  { name: 'Rishav Verma', role: 'JE', department: 'Electrical', campus: 'NORTH', phone: '9876500008' },
  { name: 'Yashpal Thakur', role: 'JE', department: 'Electrical', campus: 'NORTH', phone: '9876500009' },
  { name: 'Chirag Vaidya', role: 'JE', department: 'Electrical', campus: 'NORTH', phone: '9876500010' },
  { name: 'Kapil Verma', role: 'JE', department: 'Electrical', campus: 'SOUTH', phone: '9876500011' },

  // -- Junior Engineer (Horticulture) ----------------------------------------
  { name: 'Munna Kumar', role: 'JE', department: 'Horticulture', campus: 'BOTH', phone: '9876500012' },

  // -- Junior Lab Assistants (Civil) — do NOT receive tickets (Q4). Seeded
  //    as APPLICANT: they can sign in and raise tickets like anyone, but
  //    are never a JE-pool candidate.
  { name: 'Deen Dyal', role: 'APPLICANT', department: 'Civil', campus: 'NORTH', phone: '9876500013' },
  { name: 'Navish Sharma', role: 'APPLICANT', department: 'Civil', campus: 'NORTH', phone: '9876500014' },
  { name: 'Vishavjeet', role: 'APPLICANT', department: 'Civil', campus: 'NORTH', phone: '9876500015' },

  // -- Clerical staff ---------------------------------------------------------
  { name: 'Anil Kumar', role: 'CLERICAL', department: 'Administration', campus: null, phone: '9876500016' },
  { name: 'Aman Yadav', role: 'CLERICAL', department: 'Administration', campus: null, phone: '9876500017' },
  { name: 'Lalit Kumar', role: 'CLERICAL', department: 'Administration', campus: null, phone: '9876500018' },

  // -- Accountant ---------------------------------------------------------------
  { name: 'Jyoti Singh', role: 'ACCOUNTANT', department: 'Administration', campus: null, phone: '9876500019' },

  // -- Office Attendant — "needs no portal role" (plan.md §3.2): seeded as a
  //    plain APPLICANT so the 20-person roster is complete, with no desk power.
  { name: 'Vijay Kumar', role: 'APPLICANT', department: 'Administration', campus: null, phone: '9876500020' },
];

// Dummy Dean/Director (Q7) — not part of the 20, seeded separately and only
// if that role has nobody in it yet.
const DUMMY_AUTHORITIES = [
  { name: 'Dean (unassigned)', role: 'DEAN', department: 'Administration', email: 'dean.dummy@campus.edu', phone: null },
  { name: 'Director (unassigned)', role: 'DIRECTOR', department: 'Administration', email: 'director.dummy@campus.edu', phone: null },
];

// Cross-department AE coverage from staffDetails.md ("additional charge of
// ... Horticulture, North/South campus") — the Civil AE for each campus also
// runs that campus's Horticulture desk. This is what services/assignment.js
// (plan.md §3.2) reads to route a Horticulture UNASSIGNED ticket to the
// right AE; it cannot be expressed by the single users.department column.
const EXTRA_AE_SCOPES = [
  { email: 'siddarth.jamwal@campus.edu', department: 'Horticulture', campus: 'NORTH' },
  { email: 'vikas.kumar.chaudhary@campus.edu', department: 'Horticulture', campus: 'SOUTH' },
];

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '.');
}

async function seedRoster(connection) {
  let inserted = 0;
  let skipped = 0;

  for (const person of ROSTER) {
    const slug = slugify(person.name);
    const email = `${slug}@campus.edu`;
    const firebaseUid = `seed_staff_${slug}`;

    const [result] = await connection.query(
      `INSERT IGNORE INTO mnt_users (firebase_uid, name, email, role, department, campus, phone)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [firebaseUid, person.name, email, person.role, person.department, person.campus, person.phone]
    );

    if (result.affectedRows > 0) {
      inserted += 1;
      console.log(`  + ${person.name} (${person.role}, ${person.department}${person.campus ? `, ${person.campus}` : ''}) -> ${email}`);
    } else {
      skipped += 1;
      console.log(`  = ${person.name} already seeded (${email}), left as-is`);
    }
  }

  return { inserted, skipped };
}

// user_scopes (plan.md §3.1/§3.2): every JE/AE/SE gets their primary
// (department, campus) carried over from the users row, plus the two
// hand-mapped cross-department AE scopes above. Idempotent via INSERT
// IGNORE on the (user_id, department, campus) unique key, same pattern as
// the roster/authority seeding.
async function seedScopes(connection) {
  const [primary] = await connection.query(
    `INSERT IGNORE INTO mnt_user_scopes (user_id, department, campus)
     SELECT id, department, campus FROM mnt_users
      WHERE role IN ('JE', 'AE', 'SE') AND campus IS NOT NULL`
  );

  let extraInserted = 0;
  for (const scope of EXTRA_AE_SCOPES) {
    const [userRows] = await connection.query('SELECT id FROM mnt_users WHERE email = ?', [scope.email]);
    if (userRows.length === 0) {
      console.log(`  ! ${scope.email} not found, skipping extra scope (${scope.department}, ${scope.campus})`);
      continue;
    }
    const [result] = await connection.query(
      `INSERT IGNORE INTO mnt_user_scopes (user_id, department, campus) VALUES (?, ?, ?)`,
      [userRows[0].id, scope.department, scope.campus]
    );
    if (result.affectedRows > 0) {
      extraInserted += 1;
      console.log(`  + ${scope.email} -> extra scope (${scope.department}, ${scope.campus})`);
    }
  }

  return { primaryInserted: primary.affectedRows, extraInserted };
}

async function seedDummyAuthority(connection, authority) {
  const [existing] = await connection.query('SELECT id, name, email FROM mnt_users WHERE role = ?', [authority.role]);

  if (existing.length > 0) {
    console.log(`  = ${authority.role} already has an account (${existing[0].email}), leaving it alone`);
    return false;
  }

  const slug = slugify(authority.name);
  const firebaseUid = `seed_staff_${slug}`;

  await connection.query(
    `INSERT INTO mnt_users (firebase_uid, name, email, role, department, campus, phone)
     VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    [firebaseUid, authority.name, authority.email, authority.role, authority.department, authority.phone]
  );

  console.log(`  + ${authority.name} (${authority.role}) -> ${authority.email}`);
  return true;
}

async function seedStaff() {
  const connection = await pool.getConnection();
  try {
    console.log('Seeding construction-wing roster (staffDetails.md)...');
    const { inserted, skipped } = await seedRoster(connection);

    console.log('Seeding dummy Dean/Director (Q7)...');
    let authoritiesInserted = 0;
    for (const authority of DUMMY_AUTHORITIES) {
      if (await seedDummyAuthority(connection, authority)) authoritiesInserted += 1;
    }

    console.log('Seeding user_scopes (plan.md §3.2)...');
    const { primaryInserted, extraInserted } = await seedScopes(connection);

    console.log('================================================================');
    console.log(`Roster: ${inserted} inserted, ${skipped} already present.`);
    console.log(`Authorities: ${authoritiesInserted} inserted.`);
    console.log(`Scopes: ${primaryInserted} primary, ${extraInserted} extra AE scopes inserted.`);
    console.log('================================================================');
  } finally {
    connection.release();
    process.exit(0);
  }
}

seedStaff().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
