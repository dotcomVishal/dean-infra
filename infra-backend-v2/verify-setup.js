import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './src/config/db.js';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('Running Pre-Flight Rigidity Checks...\n');

const checks = [
  { name: 'Environment Variables (.env)', path: path.join(__dirname, '.env') },
  { name: 'Firebase Service Account JSON', path: path.join(__dirname, 'serviceAccountKey.json') },
  { name: 'Uploads Directory', path: path.join(__dirname, 'uploads') },
];

let passed = true;

// 1. Check Files and Folders
checks.forEach(check => {
  if (fs.existsSync(check.path)) {
    console.log(`[OK] ${check.name} found.`);
  } else {
    console.error(`[MISSING] ${check.name} is missing at ${check.path}`);
    passed = false;
  }
});

// 2. Check Database Connection
console.log('\n🔍 Testing Database Connection...');
try {
  const connection = await pool.getConnection();
  console.log('[OK] Database connection successful.');
  connection.release();
} catch (error) {
  console.error(`[FAILED] Database connection failed:`, error.message);
  passed = false;
}

// 3. Final Verdict
if (passed) {
  console.log('\n ALL CHECKS PASSED! The backend structure is rigid and ready for testing.');
  process.exit(0);
} else {
  console.log('\nSOME CHECKS FAILED. Please fix the missing items above.');
  process.exit(1);
}