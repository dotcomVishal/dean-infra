import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import { upload } from './middleware/upload.js';
import userRoutes from './routes/userRoutes.js';
import ticketRoutes from './routes/ticketRoutes.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health check & Generic test upload
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Deanery Infra Backend is running' });
});

app.post('/api/upload', upload.array('files', 5), (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ success: false, message: 'No files uploaded' });
  res.json({ success: true, files: req.files.map(f => ({ filename: f.filename, url: `/uploads/${f.filename}` })) });
});

// API Routes
app.use('/api/users', userRoutes);
app.use('/api/tickets', ticketRoutes);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});