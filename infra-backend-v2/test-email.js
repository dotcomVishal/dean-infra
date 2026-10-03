import dotenv from 'dotenv';
dotenv.config();
import { transporter } from './src/utils/mailer.js'; // same config as production (O1)

console.log('🔍 Testing SMTP Connection...');

async function testEmail() {
  try {
    await transporter.verify();
    console.log('✅ SMTP Connection Verified! Credentials are correct.');

    const info = await transporter.sendMail({
      from: `"Deanery Infra Diagnostics" <${process.env.SMTP_USER}>`,
      to: process.env.SMTP_USER, // Sending it to yourself
      subject: 'System Diagnostic: SMTP Works',
      text: 'If you are reading this, your Node.js SMTP configuration is fully operational.',
    });

    console.log(`✅ Test email sent successfully! Message ID: ${info.messageId}`);
    process.exit(0);
  } catch (error) {
    console.error('\n❌ SMTP Test Failed:');
    console.error(error.message);
    process.exit(1);
  }
}

testEmail();