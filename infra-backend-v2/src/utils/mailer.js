import nodemailer from 'nodemailer';

// SMTP_PORT arrives as a string from the environment.
const port = Number(process.env.SMTP_PORT) || 465;

export const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port,
  // O1: 465 = implicit TLS (secure: true); 587 / 25 = STARTTLS (secure: false).
  // SMTP_SECURE=true|false overrides for unusual providers.
  secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
  // A hung SMTP server must fail the attempt so the outbox worker can retry it.
  connectionTimeout: 15_000,
  greetingTimeout: 15_000,
  socketTimeout: 30_000,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * The only way app code sends mail. THROWS on failure -- the `notifications`
 * outbox worker (cron/emailReminders.js) owns retry, backoff and give-up.
 * Do not call this from request handlers: enqueue via services/notifier.js.
 */
export const deliverEmail = async ({ to, cc, subject, text }) => {
  await transporter.sendMail({
    from: `"Deanery Infra" <${process.env.SMTP_USER}>`,
    to,
    ...(cc ? { cc } : {}),
    subject,
    text,
  });
};

/** Placeholder accounts use the reserved `.invalid` TLD (RFC 2606): mail to them can never be delivered. */
export const isPlaceholderEmail = (email) => /\.invalid$/i.test(String(email ?? '').trim());
