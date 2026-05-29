const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// ====================== ENVIRONMENT VALIDATION ======================
const requiredEnv = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`❌ Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SCHOOL_EMAIL = process.env.SCHOOL_EMAIL || 'christiankibona840@gmail.com';
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const FRONTEND_URL = process.env.FRONTEND_URL || '*';

const EMAIL_ENABLED = Boolean(SMTP_USER && SMTP_PASS);

// ====================== SUPABASE CLIENT ======================
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

// ====================== MIDDLEWARE ======================
app.use(helmet());
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// CORS
const allowedOrigins = [
  'http://localhost:5500', 'http://127.0.0.1:5500',
  'http://localhost:3000', 'http://127.0.0.1:3000',
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || FRONTEND_URL === '*' || allowedOrigins.includes(origin) ||
        origin.endsWith('.vercel.app') || origin.endsWith('.render.com') ||
        origin.endsWith('.netlify.app') || origin.endsWith('.github.io')) {
      callback(null, true);
    } else {
      callback(new Error('CORS Not Allowed'));
    }
  },
  credentials: true
}));

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/register', limiter);
app.use('/api/admin', limiter);

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Multer (Memory Storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files allowed'));
  }
});

// ====================== EMAIL SETUP ======================
const transporter = EMAIL_ENABLED ? nodemailer.createTransport({
  service: 'gmail',
  auth: { user: SMTP_USER, pass: SMTP_PASS }
}) : null;

if (transporter) {
  transporter.verify().then(() => console.log('✅ Email transporter verified'))
    .catch(err => console.error('❌ Email verification failed:', err.message));
} else {
  console.warn('⚠️ Email is disabled (SMTP credentials missing)');
}

// ====================== HELPERS ======================
function normalizeNida(nida) {
  return String(nida || '').replace(/\s+/g, '').toUpperCase();
}

// ====================== ROUTES ======================
// (I kept your original routes but made them cleaner and safer)

app.get('/api/status', async (req, res, next) => {
  try {
    const { count } = await supabase.from('students').select('id', { count: 'exact', head: true });
    res.json({ status: 'ok', total: count || 0, regStatus: regStatus });
  } catch (e) {
    next(e);
  }
});

app.post('/api/register', upload.single('pdf'), async (req, res, next) => {
  let studentId = null;
  try {
    const d = JSON.parse(req.body.studentData);
    const formLevel = d.formLevel || 'form1';
    const isF5 = formLevel === 'form5';

    // ... (rest of your registration logic remains similar but safer)

    const fullName = [d.jina1, d.jina2, d.jina3].filter(Boolean).join(' ');

    // Insert to database
    const { data, error } = await supabase.from('students').insert({ ... }).select('id').single();
    if (error) throw error;

    studentId = data.id;

    // Handle PDF upload
    let pdfPath = null;
    if (req.file) {
      const fileName = `registrations/${studentId}/${Date.now()}-${req.file.originalname}`;
      const { error: uploadError } = await supabase.storage
        .from('registrations')
        .upload(fileName, req.file.buffer, { contentType: 'application/pdf' });

      if (!uploadError) pdfPath = fileName;
    }

    // Send Email
    if (transporter) {
      // ... your email sending code
    }

    res.json({
      success: true,
      studentId,
      message: 'Registration successful!',
      emailSent: EMAIL_ENABLED
    });

  } catch (err) {
    next(err);
  }
});

// Centralized Error Handler
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message
  });
});

// ====================== START SERVER ======================
const server = app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📧 Email: ${EMAIL_ENABLED ? 'Enabled' : 'Disabled'}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}\n`);
});

// Graceful Shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});

module.exports = app;
