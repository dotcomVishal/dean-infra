import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

// Import Routes
import authRoutes from './routes/authRoutes.js';
import ticketRoutes from './routes/ticketRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import availabilityRoutes from './routes/availabilityRoutes.js';
import attachmentRoutes from './routes/attachmentRoutes.js';
import { requestId } from './middleware/requestId.js';
import { authLimiter } from './middleware/rateLimit.js';
import { errorHandler } from './middleware/errorHandler.js';

// 1. Initialize __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 2. INITIALIZE APP (This must happen before any app.use calls)
const app = express();

// S8: behind reverse proxies every request arrives with the proxy's IP. TRUST_PROXY_HOPS is
// the number of proxies in front of this process (2 in production, 0 locally and in tests).
// Per-user limits (middleware/rateLimit.js) do not depend on it; the sign-in limiter does.
const proxyHops = Number.parseInt(process.env.TRUST_PROXY_HOPS ?? '0', 10);
app.set('trust proxy', Number.isInteger(proxyHops) && proxyHops >= 0 ? proxyHops : 0);

// S12: request id + structured access log. First, so every later response
// (rate limit, 404, error) carries X-Request-Id.
app.use(requestId);

// 3. Enable CORS for all incoming requests (API and static files)
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173', 
  credentials: true // Required for secure tokens
}));

// 4. Security Headers with CORP configured for cross-origin asset loading
app.use(helmet({
  crossOriginOpenerPolicy: false, // Allows the Google login popup to work
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // API responses (incl. /api/attachments) are read by the SPA; access is gated by auth + CORS
  contentSecurityPolicy: false,   // Allows inline scripts/styles if needed
}));

// 5. Body Parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 6. Public assets only. S2: /uploads is NOT served statically -- every file goes
// through the authenticated GET /api/attachments/:id (visibility-checked).
app.use(express.static(path.join(__dirname, '../public')));

// 7. API Routes
// Rate limits: strict per-IP on sign-in here; per-person limits sit behind requireAuth in each router.
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/availability', availabilityRoutes);
app.use('/api/attachments', attachmentRoutes);
app.get('/api/health', (_req, res) => res.status(200).json({ success: true, status: 'ok' }));

// Unknown route (this is also what a direct /uploads/... URL now gets)
app.use((req, res) => res.status(404).json({ success: false, message: 'Not found', requestId: req.id }));

// 8. Global Error Handler (S12)
app.use(errorHandler);

export default app;