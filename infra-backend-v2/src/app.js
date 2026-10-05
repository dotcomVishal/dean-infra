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
import metaRoutes from './routes/metaRoutes.js';
import { requestId } from './middleware/requestId.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authFailureLimiter } from './middleware/rateLimit.js';

// 1. Initialize __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 2. INITIALIZE APP (This must happen before any app.use calls)
const app = express();

// S8: behind nginx, every request otherwise arrives with the proxy's IP, so
// the rate limiter's 100 requests / 15 min is shared by the whole institute.
app.set('trust proxy', 1);

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

// 6. Prevent brute force. X1: signed-in traffic is limited per user inside each
// router (middleware/rateLimit.js); only rejected tokens are counted per address.
app.use('/api/', authFailureLimiter);

// 7. API Routes
app.use('/api/auth', authRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/availability', availabilityRoutes);
app.use('/api/attachments', attachmentRoutes);
app.use('/api/meta', metaRoutes);
app.get('/api/health', (_req, res) => res.status(200).json({ success: true, status: 'ok' }));

// Unknown route (this is also what a direct /uploads/... URL now gets)
app.use((req, res) => res.status(404).json({ success: false, message: 'Not found', requestId: req.id }));

// 8. Global Error Handler (S12)
app.use(errorHandler);

export default app;