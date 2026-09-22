import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import pool from '../src/config/db.js';
import { createTicket, submitReport } from '../src/controllers/ticketController.js';

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

// Mock Express response helper
function createMockRes() {
  const res = {
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
  return res;
}

async function runControllerTests() {
  console.log('\n======================================================');
  console.log('🧪 TESTING CONTROLLER POST LOGIC & MULTIPART UPLOADS');
  console.log('======================================================\n');

  // 1. Get or create test users
  const [applicantRows] = await pool.query("SELECT id, name, email, role, department FROM users WHERE role = 'APPLICANT' LIMIT 1");
  const applicant = applicantRows[0] || { id: 1, name: 'Student Applicant', email: 'student@example.com', role: 'APPLICANT' };

  const [jeRows] = await pool.query("SELECT id, name, email, role, department FROM users WHERE role = 'JE' AND department = 'Civil' LIMIT 1");
  const je = jeRows[0];

  assert(applicant.id > 0, `Applicant user ID #${applicant.id}`);
  assert(je.id > 0, `JE user ID #${je.id}`);

  // 2. Prepare mock temp file for applicant ticket upload
  const tempDir = path.resolve('uploads/temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const mockApplicantFile = path.join(tempDir, `evidence-${Date.now()}.png`);
  fs.writeFileSync(mockApplicantFile, 'MOCK_APPLICANT_IMAGE_DATA');

  const reqCreate = {
    user: applicant,
    body: {
      title: 'Water Seepage in North Campus Cafeteria',
      description: 'Heavy seepage from overhead pipe during lunch hours.',
      department: 'Civil',
      type: 'recurring',
      location: 'Dining Hall 2'
    },
    files: [
      {
        path: mockApplicantFile,
        originalname: 'cafeteria_seepage.png',
        filename: path.basename(mockApplicantFile)
      }
    ]
  };

  const resCreate = createMockRes();
  console.log('Testing createTicket controller...');
  await createTicket(reqCreate, resCreate);

  assert(resCreate.statusCode === 200 || resCreate.statusCode === 201, `createTicket returned HTTP ${resCreate.statusCode}`);
  assert(resCreate.body.success === true, `createTicket success is true: ${JSON.stringify(resCreate.body)}`);
  const ticketId = resCreate.body.ticket_id || resCreate.body.ticketId;
  assert(ticketId > 0, `Ticket created with ID #${ticketId}`);

  // 3. Verify attachment in database with document_category
  const [attRows] = await pool.query("SELECT * FROM attachments WHERE ticket_id = ?", [ticketId]);
  assert(attRows.length === 1, `Attachment saved in DB: count = ${attRows.length}`);
  assert(attRows[0].document_category === 'APPLICANT_EVIDENCE', `document_category is APPLICANT_EVIDENCE: actual = ${attRows[0].document_category}`);

  // 4. Verify ticket details
  const [ticketRows] = await pool.query("SELECT * FROM tickets WHERE id = ?", [ticketId]);
  assert(ticketRows.length === 1, `Ticket found in DB`);
  assert(ticketRows[0].title === 'Water Seepage in North Campus Cafeteria', 'DB contains correct ticket title');

  // 5. Test JE filing inspection report with site_photos and estimate_docs
  const assignedJeId = resCreate.body.assigned_je_id || je.id;
  const [assignedJeRows] = await pool.query("SELECT id, name, email, role, department FROM users WHERE id = ?", [assignedJeId]);
  const assignedJe = assignedJeRows[0];

  const mockSitePhoto = path.join(tempDir, `site-photo-${Date.now()}.png`);
  fs.writeFileSync(mockSitePhoto, 'MOCK_SITE_PHOTO_DATA');

  const mockEstimateDoc = path.join(tempDir, `estimate-doc-${Date.now()}.pdf`);
  fs.writeFileSync(mockEstimateDoc, 'MOCK_ESTIMATE_DOC_DATA');

  const reqInspection = {
    user: assignedJe,
    params: { ticket_id: ticketId },
    body: {
      nature_of_work: 'Pipe valve replacement and masonry waterproofing.',
      remarks: 'Inspected site. Leakage requires valve change and waterproofing.',
      estimated_amount: 18500
    },
    files: {
      site_photos: [
        {
          path: mockSitePhoto,
          originalname: 'leakage_macro.png',
          filename: path.basename(mockSitePhoto)
        }
      ],
      estimate_docs: [
        {
          path: mockEstimateDoc,
          originalname: 'cpwd_estimate.pdf',
          filename: path.basename(mockEstimateDoc)
        }
      ]
    }
  };

  const resInspection = createMockRes();
  console.log('Testing submitReport controller...');
  await submitReport(reqInspection, resInspection);

  assert(resInspection.statusCode === 200, `submitReport returned HTTP ${resInspection.statusCode}`);
  assert(resInspection.body.success === true, `submitReport success is true: ${JSON.stringify(resInspection.body)}`);

  // 6. Verify inspection attachments in database
  const [allAttRows] = await pool.query("SELECT * FROM attachments WHERE ticket_id = ? ORDER BY id ASC", [ticketId]);
  assert(allAttRows.length === 3, `Total attachments after inspection is 3, got ${allAttRows.length}`);
  const categories = allAttRows.map(a => a.document_category);
  assert(categories.includes('APPLICANT_EVIDENCE'), 'Contains APPLICANT_EVIDENCE');
  assert(categories.includes('JE_SITE_PHOTO'), 'Contains JE_SITE_PHOTO');
  assert(categories.includes('JE_ESTIMATE_DOC'), 'Contains JE_ESTIMATE_DOC');

  // 7. Verify ticket status moved to PENDING_AE_APPROVAL
  const [ticketAfter] = await pool.query("SELECT status FROM tickets WHERE id = ?", [ticketId]);
  assert(ticketAfter[0].status === 'PENDING_AE_APPROVAL', `Ticket moved to PENDING_AE_APPROVAL, actual = ${ticketAfter[0].status}`);

  console.log('\n======================================================');
  console.log(`🎉 ALL CONTROLLER TESTS PASSED: ${passed} Passed, ${failed} Failed`);
  console.log('======================================================\n');
  process.exit(0);
}

runControllerTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
