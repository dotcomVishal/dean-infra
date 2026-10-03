import 'dotenv/config';
import '../src/config/requireTestDb.js';
import fs from 'fs';
import path from 'path';
import pool from '../src/config/db.js';
import { runMigrations } from '../src/config/migrate.js';
import { moveFile } from '../src/utils/fileManager.js';
import { resolveAction, availableActions, STATUS, ROLE, WorkflowError } from '../src/config/workflow.js';

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

async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 DEANERY OF INFRASTRUCTURE: COMPREHENSIVE ENDPOINT & WORKFLOW TEST');
  console.log('======================================================\n');

  let connection;
  let testTicketId = null;

  try {
    connection = await pool.getConnection();

    // ----------------------------------------------------
    // TEST 1: Automatic Database Migration & Schema Sync
    // ----------------------------------------------------
    console.log('\n--- 1. Testing Schema Integrity & Migrations ---');
    await runMigrations();

    const [titleCheck] = await connection.query(`
      SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH 
      FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'infra_tickets' 
        AND COLUMN_NAME = 'title'
    `);
    assert(titleCheck.length > 0, 'Column "title" exists in tickets table');
    assert(titleCheck[0].DATA_TYPE === 'varchar', '"title" is of type VARCHAR');

    const [tendersCheck] = await connection.query(`
      SELECT TABLE_NAME FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'infra_tenders'
    `);
    assert(tendersCheck.length > 0, 'Table "tenders" exists');

    // ----------------------------------------------------
    // TEST 2: User Provisioning for Testing
    // ----------------------------------------------------
    console.log('\n--- 2. Setting Up Test Actors ---');
    // Ensure test JE exists
    const [jeUsers] = await connection.query(`
      SELECT id, name, email FROM infra_users WHERE role = 'JE' AND department = 'Civil' LIMIT 1
    `);
    let jeId;
    if (jeUsers.length === 0) {
      const [insertJe] = await connection.query(`
        INSERT INTO infra_users (firebase_uid, name, email, role, department) 
        VALUES ('mock_je_civil_uid', 'Test JE Civil', 'test.je.civil@example.com', 'JE', 'Civil')
      `);
      jeId = insertJe.insertId;
    } else {
      jeId = jeUsers[0].id;
    }
    assert(jeId > 0, `Active Civil JE identified with ID #${jeId}`);

    // Ensure test Applicant exists
    const [appUsers] = await connection.query(`
      SELECT id, name, email FROM infra_users WHERE role = 'APPLICANT' LIMIT 1
    `);
    let applicantId;
    if (appUsers.length === 0) {
      const [insertApp] = await connection.query(`
        INSERT INTO infra_users (firebase_uid, name, email, role, department) 
        VALUES ('mock_app_uid', 'Test Applicant User', 'applicant.test@gmail.com', 'APPLICANT', 'General')
      `);
      applicantId = insertApp.insertId;
    } else {
      applicantId = appUsers[0].id;
    }
    assert(applicantId > 0, `Applicant user identified with ID #${applicantId}`);

    // ----------------------------------------------------
    // TEST 3: Ticket Creation with Title & File Attachment
    // ----------------------------------------------------
    console.log('\n--- 3. Testing Ticket Creation with Title & File Upload ---');
    const testTitle = 'E2E Test: Library Roof Leakage Repair';
    const testDesc = 'Critical water seepage identified in main reading hall during rains.';
    const testLocation = 'Central Library, 2nd Floor West Wing';

    // Insert ticket with title
    const [ticketInsert] = await connection.query(
      `INSERT INTO infra_tickets (applicant_id, assigned_je_id, department, title, type, description, landmark, status) 
       VALUES (?, ?, 'Civil', ?, 'recurring', ?, ?, 'ASSIGNED_TO_JE')`,
      [applicantId, jeId, testTitle, testDesc, testLocation]
    );
    testTicketId = ticketInsert.insertId;
    assert(testTicketId > 0, `Ticket created successfully with ID #${testTicketId}`);

    // Verify ticket in database has exact title
    const [savedTicket] = await connection.query(
      'SELECT id, title, department, description, landmark, status FROM infra_tickets WHERE id = ?',
      [testTicketId]
    );
    assert(savedTicket.length === 1, 'Ticket successfully fetched from MySQL');
    assert(savedTicket[0].title === testTitle, `Ticket title verified: "${savedTicket[0].title}"`);
    assert(savedTicket[0].status === 'ASSIGNED_TO_JE', 'Initial status is ASSIGNED_TO_JE');

    // Test File Storage & Attachment
    const tempDir = path.resolve('uploads/temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const mockTempFile = path.join(tempDir, `mock-evidence-${Date.now()}.png`);
    fs.writeFileSync(mockTempFile, Buffer.from('FAKE_IMAGE_DATA_FOR_UNIT_TEST'));

    const movedFileUrl = await moveFile(
      { path: mockTempFile, originalname: 'site-photo.png', filename: path.basename(mockTempFile) },
      testTicketId,
      'applicant_evidence'
    );
    assert(typeof movedFileUrl === 'string' && movedFileUrl.startsWith('/uploads/'), 'File moved to target upload directory');

    const physicalPath = path.resolve(movedFileUrl.replace(/^\//, ''));
    assert(fs.existsSync(physicalPath), `Physical file verified on filesystem: ${physicalPath}`);

    // Insert attachment record
    await connection.query(
      'INSERT INTO infra_attachments (ticket_id, file_url, uploaded_by, document_category) VALUES (?, ?, ?, ?)',
      [testTicketId, movedFileUrl, applicantId, 'APPLICANT_EVIDENCE']
    );

    const [attachments] = await connection.query(
      'SELECT * FROM infra_attachments WHERE ticket_id = ?',
      [testTicketId]
    );
    assert(attachments.length > 0, 'Attachment record saved in DB');
    assert(attachments[0].document_category === 'APPLICANT_EVIDENCE', 'Document category is APPLICANT_EVIDENCE');

    // ----------------------------------------------------
    // TEST 4: JE Inspection Report Filing
    // ----------------------------------------------------
    console.log('\n--- 4. Testing JE Inspection Report Filing ---');
    const estimatedAmount = 45000.00; // Rs. 45,000 (Above AE Rs. 25,000 ceiling)
    const natureOfWork = 'Waterproofing bitumen sheet overlay, crack sealing and drainage slope correction.';

    await connection.query(
      'INSERT INTO infra_reports (ticket_id, je_id, nature_of_work, estimated_amount) VALUES (?, ?, ?, ?)',
      [testTicketId, jeId, natureOfWork, estimatedAmount]
    );

    // State machine transition: JE filing report moves ticket to PENDING_AE_APPROVAL
    const jeTransition = resolveAction({
      user: { id: jeId, role: ROLE.JE },
      ticket: { status: STATUS.ASSIGNED_TO_JE, current_desk_user_id: jeId },
      action: 'SUBMIT_REPORT',
      estimate: estimatedAmount
    });
    assert(jeTransition.toStatus === STATUS.PENDING_AE_APPROVAL, 'Workflow state transitioned to PENDING_AE_APPROVAL');

    await connection.query('UPDATE infra_tickets SET status = ? WHERE id = ?', [jeTransition.toStatus, testTicketId]);

    // ----------------------------------------------------
    // TEST 5: Authority Review & Auto-Escalation Ladder
    // ----------------------------------------------------
    console.log('\n--- 5. Testing Financial Ceilings & Auto-Escalation Ladder ---');
    // The AE has no approval power (Q1): it can only forward Rs. 45,000 to the SE.
    const LIMITS = { SE_APPROVE: 50000, DEAN_APPROVE: 500000 };
    const aeUser = { id: 501, role: ROLE.AE };
    const atAe = { status: STATUS.PENDING_AE_APPROVAL, current_desk_user_id: 501, estimate: estimatedAmount };
    let aeApproveRefused = false;
    try { resolveAction({ user: aeUser, ticket: atAe, limits: LIMITS, action: 'APPROVE' }); }
    catch (e) { aeApproveRefused = e instanceof WorkflowError && e.code === 'ACTION_NOT_ALLOWED'; }
    assert(aeApproveRefused, 'AE cannot APPROVE (Q1) -- only FORWARD / REQUEST_CHANGES');
    const aeTransition = resolveAction({ user: aeUser, ticket: atAe, limits: LIMITS, action: 'FORWARD' });
    assert(aeTransition.toStatus === STATUS.PENDING_SE_APPROVAL, 'AE FORWARD moves the ticket to PENDING_SE_APPROVAL');

    await connection.query('UPDATE infra_tickets SET status = ? WHERE id = ?', [aeTransition.toStatus, testTicketId]);

    // SE approves Rs. 45,000 (limit Rs. 50,000 -> within limit -> sanctioned)
    const seUser = { id: 502, role: ROLE.SE };
    const atSe = { status: STATUS.PENDING_SE_APPROVAL, current_desk_user_id: 502, estimate: estimatedAmount };
    const seTransition = resolveAction({ user: seUser, ticket: atSe, limits: LIMITS, action: 'APPROVE' });
    assert(seTransition.toStatus === STATUS.APPROVED_FOR_TENDERING, 'SE approval sanctions work -> APPROVED_FOR_TENDERING (<= 50k)');
    const seAbove = availableActions(seUser, { ...atSe, estimate: 60000 }, LIMITS).actions.find(a => a.action === 'APPROVE');
    assert(seAbove.enabled === false && seAbove.code === 'ABOVE_LIMIT', 'SE APPROVE disabled above 50k (forces FORWARD)');

    await connection.query('UPDATE infra_tickets SET status = ? WHERE id = ?', [seTransition.toStatus, testTicketId]);

    // ----------------------------------------------------
    // TEST 6: JE tender milestones
    // ----------------------------------------------------
    console.log('\n--- 6. Testing tender milestones (NIT & Award) ---');
    const nitNumber = `NIT/IITM/INFRA/2026/${testTicketId}`;

    const [tenderInsert] = await connection.query(`
      INSERT INTO infra_tenders (
        ticket_id, nit_number, portal_type, tender_created_date, tender_end_date, 
        status, remarks, created_by
      ) VALUES (?, ?, 'GeM', CURDATE(), DATE_ADD(CURDATE(), INTERVAL 14 DAY), 'PUBLISHED', 'E2E Test Tender', ?)
    `, [testTicketId, nitNumber, applicantId]);
    const tenderId = tenderInsert.insertId;
    assert(tenderId > 0, `Tender published on GeM with NIT: ${nitNumber}`);

    // Update ticket status to TENDER_PUBLISHED
    await connection.query("UPDATE infra_tickets SET status = 'TENDER_PUBLISHED' WHERE id = ?", [testTicketId]);

    // Award tender to vendor
    const awardedAgency = 'M/s Himachal Construction Ltd';
    const workOrderValue = 42500.00;

    await connection.query(`
      UPDATE infra_tenders SET 
        status = 'AWARDED',
        awarded_agency = ?,
        award_amount = ?
      WHERE id = ?
    `, [awardedAgency, workOrderValue, tenderId]);

    await connection.query("UPDATE infra_tickets SET status = 'WORK_IN_PROGRESS' WHERE id = ?", [testTicketId]);

    const [updatedTicket] = await connection.query('SELECT status FROM infra_tickets WHERE id = ?', [testTicketId]);
    assert(updatedTicket[0].status === 'WORK_IN_PROGRESS', 'Ticket milestone transitioned to WORK_IN_PROGRESS');

    // Close out ticket
    await connection.query("UPDATE infra_tickets SET status = 'CLOSED' WHERE id = ?", [testTicketId]);
    const [closedTicket] = await connection.query('SELECT status FROM infra_tickets WHERE id = ?', [testTicketId]);
    assert(closedTicket[0].status === 'CLOSED', 'Ticket workflow completed and successfully CLOSED');

    console.log('\n======================================================');
    console.log(`🎉 ALL TESTS COMPLETED: ${passed} Passed, ${failed} Failed`);
    console.log('======================================================\n');

  } catch (error) {
    console.error('\n💥 TEST EXECUTION FAILED:', error);
    process.exit(1);
  } finally {
    if (connection) {
      // Clean up test ticket and dependencies
      if (testTicketId) {
        await connection.query('DELETE FROM infra_tickets WHERE id = ?', [testTicketId]).catch(() => {});
      }
      connection.release();
    }
    process.exit(failed > 0 ? 1 : 0);
  }
}

runTests();
