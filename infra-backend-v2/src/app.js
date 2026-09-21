import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';

// Import Routes
import authRoutes from './routes/authRoutes.js';
import ticketRoutes from './routes/ticketRoutes.js';
import adminRoutes from './routes/adminRoutes.js';

// 1. Initialize __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 2. INITIALIZE APP (This must happen before any app.use calls)
const app = express();

// 3. Enable CORS for all incoming requests (API and static files)
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173', 
  credentials: true // Required for secure tokens
}));

// 4. Security Headers with CORP configured for cross-origin asset loading
app.use(helmet({
  crossOriginOpenerPolicy: false, // Allows the Google login popup to work
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allows frontend to load images/files from /uploads
  contentSecurityPolicy: false,   // Allows inline scripts/styles if needed
}));

// 5. Body Parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 6. Serve the Public and Uploads folders with explicit CORS and CORP headers
app.use(express.static(path.join(__dirname, '../public')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads'), {
  setHeaders: (res) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
}));

// 6. Prevent Brute Force
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests, please try again later.'
});
app.use('/api/', apiLimiter);

// 7. API Routes
app.use('/api/auth', authRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/admin', adminRoutes);
app.get('/api/health', (_req, res) => res.status(200).json({ success: true, status: 'ok' }));

// 8. Global Error Handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Internal Server Error' });
});

export default app;