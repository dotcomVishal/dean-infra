import 'dotenv/config';
import pool from '../src/config/db.js';
import { 
  getAllUsers, 
  createUser, 
  updateUser, 
  getAdminMetrics, 
  getAllTickets, 
  overrideTicketStatus 
} from '../src/controllers/adminController.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  ❌ FAILED: ${message}`);
    failed++;
    throw new Error(message);
  }
  console.log(`  ✅ PASSED: ${message}`);
  passed++;
}

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    }
  };
}

async function runAdminTests() {
  console.log('\n======================================================');
  console.log('🧪 TESTING ADMIN MASTER CONSOLE & USER MANAGEMENT');
  console.log('======================================================\n');

  // 1. Get or create a Sysadmin user for auth context
  let [adminRows] = await pool.query("SELECT id, name, email, role, department FROM users WHERE role = 'SYSADMIN' LIMIT 1");
  let sysadmin;
  if (adminRows.length === 0) {
    const [res] = await pool.query(
      `INSERT INTO users (firebase_uid, name, email, role, department, is_active)
       VALUES ('mock_sysadmin_uid', 'System Administrator', 'admin.test@iitmandi.ac.in', 'SYSADMIN', 'IT', TRUE)`
    );
    sysadmin = { id: res.insertId, name: 'System Administrator', email: 'admin.test@iitmandi.ac.in', role: 'SYSADMIN', department: 'IT' };
  } else {
    sysadmin = adminRows[0];
  }
  assert(sysadmin.id > 0, `Sysadmin actor verified with ID #${sysadmin.id}`);

  // 2. Test getAllUsers
  console.log('\n--- 1. Testing GET /admin/users Query & Filters ---');
  const reqUsers = { query: { search: '', role: 'ALL', department: 'ALL' } };
  const resUsers = createMockRes();
  await getAllUsers(reqUsers, resUsers);
  assert(resUsers.statusCode === 200, `getAllUsers returned HTTP ${resUsers.statusCode}`);
  assert(Array.isArray(resUsers.body.users), 'users list is returned as array');
  assert(resUsers.body.users.length > 0, `Returned ${resUsers.body.users.length} registered users`);

  // 3. Test createUser with Invalid JE Department ("General")
  console.log('\n--- 2. Testing JE Department Restriction (Can JE be General?) ---');
  const reqInvalidJe = {
    body: {
      full_name: 'Invalid General JE',
      email: `bad_je_${Date.now()}@example.com`,
      role: 'JE',
      department: 'General' // Illegal!
    }
  };
  const resInvalidJe = createMockRes();
  await createUser(reqInvalidJe, resInvalidJe);
  assert(resInvalidJe.statusCode === 400, `Creating JE with "General" department was rejected with HTTP 400`);
  assert(resInvalidJe.body.message.includes('Civil, Electrical, or Horticulture'), `Validation message properly informs admin: "${resInvalidJe.body.message}"`);

  // 4. Test createUser with Valid Engineering Department ("Civil")
  console.log('\n--- 3. Testing Valid User Creation (Without Password) ---');
  const testEmail = `new_je_${Date.now()}@example.com`;
  const reqValidJe = {
    body: {
      full_name: 'Test Civil Junior Engineer',
      email: testEmail,
      role: 'JE',
      department: 'Civil'
    }
  };
  const resValidJe = createMockRes();
  await createUser(reqValidJe, resValidJe);
  assert(resValidJe.statusCode === 200, `createUser returned HTTP ${resValidJe.statusCode}`);
  assert(resValidJe.body.success === true, 'createUser returned success: true');
  const createdUserId = resValidJe.body.user.id;
  assert(createdUserId > 0, `Created User ID #${createdUserId}`);
  assert(resValidJe.body.user.role === 'JE', 'User role is JE');
  assert(resValidJe.body.user.department === 'Civil', 'User department is Civil');

  // 5. Test updateUser with PUT method (Fixing "Cannot PUT /api/admin/users/:id")
  console.log('\n--- 4. Testing PUT /admin/users/:id (Setting Update) ---');
  // Attempt invalid update: changing department of JE to "General"
  const reqPutInvalid = {
    params: { id: createdUserId },
    body: {
      full_name: 'Test Civil Junior Engineer Updated',
      role: 'JE',
      department: 'General', // Illegal!
      is_active: true
    }
  };
  const resPutInvalid = createMockRes();
  await updateUser(reqPutInvalid, resPutInvalid);
  assert(resPutInvalid.statusCode === 400, `Updating JE department to "General" was rejected with HTTP 400`);

  // Valid update: changing department to "Electrical" and updating name
  const reqPutValid = {
    params: { id: createdUserId },
    body: {
      full_name: 'Test Electrical JE Renamed',
      role: 'JE',
      department: 'Electrical',
      phone: '9876543210',
      is_active: true
    }
  };
  const resPutValid = createMockRes();
  await updateUser(reqPutValid, resPutValid);
  assert(resPutValid.statusCode === 200, `updateUser via PUT returned HTTP 200`);
  assert(resPutValid.body.success === true, 'User updated successfully');
  assert(resPutValid.body.user.name === 'Test Electrical JE Renamed', `User name updated to: ${resPutValid.body.user.name}`);
  assert(resPutValid.body.user.department === 'Electrical', `User department updated to: ${resPutValid.body.user.department}`);
  assert(resPutValid.body.user.phone === '9876543210', `User phone updated to: ${resPutValid.body.user.phone}`);

  // 6. Test Deactivating user
  console.log('\n--- 5. Testing Account Deactivation & Status Toggle ---');
  const reqDeactivate = {
    params: { id: createdUserId },
    body: { is_active: false }
  };
  const resDeactivate = createMockRes();
  await updateUser(reqDeactivate, resDeactivate);
  assert(resDeactivate.statusCode === 200, `Deactivation returned HTTP 200`);
  assert(Boolean(resDeactivate.body.user.is_active) === false, 'Account is now deactivated');

  // 7. Test Admin Metrics & Ticket Overrides
  console.log('\n--- 6. Testing Admin Metrics & Ticket Controls ---');
  const reqMetrics = {};
  const resMetrics = createMockRes();
  await getAdminMetrics(reqMetrics, resMetrics);
  assert(resMetrics.statusCode === 200, `getAdminMetrics returned HTTP 200`);
  assert(typeof resMetrics.body.metrics.totalUsers === 'number', 'totalUsers metric is numeric');
  assert(typeof resMetrics.body.metrics.totalTickets === 'number', 'totalTickets metric is numeric');

  console.log('\n======================================================');
  console.log(`🎉 ALL ADMIN TESTS PASSED: ${passed} Passed, ${failed} Failed`);
  console.log('======================================================\n');
  process.exit(0);
}

runAdminTests().catch(err => {
  console.error('Admin test execution error:', err);
  process.exit(1);
});
