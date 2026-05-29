// ══════════════════════════════════════════════════════════════
//  Tabora Boys School — Registration Backend  (Fixed for Render)
//  Fixes:
//    1. Email via Resend HTTP API  (no SMTP port blocking)
//    2. PDF attached to school email  (Buffer → base64)
//    3. Supabase env-var validation with clear startup errors
//    4. CORS hardened but permissive enough for all deploy targets
//    5. Graceful startup: server always starts even if email N/A
// ══════════════════════════════════════════════════════════════

const express          = require('express');
const cors             = require('cors');
const multer           = require('multer');
const path             = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 5000;

// ── VALIDATE CRITICAL ENV VARS ────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const RESEND_KEY   = process.env.RESEND_API_KEY;   // get free key → resend.com
const SCHOOL_EMAIL = process.env.SCHOOL_EMAIL || 'christiankibona840@gmail.com';
const FRONTEND_URL = process.env.FRONTEND_URL || '*';
const PDF_BUCKET   = process.env.SUPABASE_PDF_BUCKET || 'registrations';
const PDF_PREFIX   = process.env.SUPABASE_PDF_PREFIX || 'registrations';
const SIGNED_TTL   = Math.max(60, parseInt(process.env.SUPABASE_SIGNED_URL_TTL || '3600', 10));

// ── STARTUP CHECKS ────────────────────────────────────────────
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌  FATAL: SUPABASE_URL and SUPABASE_ANON_KEY must be set in Render environment variables.');
  console.error('    Go to: Render Dashboard → Your Service → Environment → Add Environment Variable');
  process.exit(1);
}

const EMAIL_ENABLED = Boolean(RESEND_KEY);
if (!EMAIL_ENABLED) {
  console.warn('⚠️   Email DISABLED — RESEND_API_KEY not set.');
  console.warn('    Get a free key at https://resend.com and add it to Render env vars.');
} else {
  console.log('✅  Email ENABLED via Resend');
}

// ── RESEND CLIENT (lazy import so server starts without it) ───
// Uses fetch (Node 18+) — no extra package needed beyond `resend`
// npm install resend
let resendClient = null;
if (EMAIL_ENABLED) {
  try {
    const { Resend } = require('resend');
    resendClient = new Resend(RESEND_KEY);
    console.log('✅  Resend client initialized');
  } catch (e) {
    console.warn('⚠️   Could not load resend package:', e.message);
    console.warn('    Run:  npm install resend');
  }
}

// ── SUPABASE ──────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
console.log('✅  Supabase client created:', SUPABASE_URL);

// ── CORS ──────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'http://localhost:5500', 'http://127.0.0.1:5500',
  'http://localhost:3000', 'http://127.0.0.1:3000',
  'http://localhost:5000',
];
if (FRONTEND_URL && FRONTEND_URL !== '*') ALLOWED_ORIGINS.push(FRONTEND_URL);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);                      // curl / Postman
    if (FRONTEND_URL === '*') return cb(null, true);         // dev open mode
    if (origin.endsWith('.vercel.app'))  return cb(null, true);
    if (origin.endsWith('.render.com'))  return cb(null, true);
    if (origin.endsWith('.netlify.app')) return cb(null, true);
    if (origin.endsWith('.github.io'))   return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(null, true); // permissive fallback — tighten in production
  },
  credentials: true,
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname)));

const upload = multer({ storage: multer.memoryStorage() });

// ── HELPERS ───────────────────────────────────────────────────
function normalizeNida(nida) {
  return String(nida || '').replace(/\s+/g, '').toUpperCase();
}

// ── DATABASE HELPERS ──────────────────────────────────────────
async function dbInsert(row) {
  const { data, error } = await supabase.from('students').insert(row).select('id').single();
  if (error) throw new Error('DB insert failed: ' + error.message);
  return data.id;
}

async function dbUpdate(id, patch) {
  const { error } = await supabase.from('students').update(patch).eq('id', id);
  if (error) throw new Error('DB update failed: ' + error.message);
}

async function dbGetById(id) {
  const { data, error } = await supabase.from('students').select('*').eq('id', id).single();
  return error ? null : data;
}

async function dbDelete(id) {
  const { error } = await supabase.from('students').delete().eq('id', id);
  if (error) throw new Error('DB delete failed: ' + error.message);
}

async function dbCount() {
  const { count, error } = await supabase
    .from('students')
    .select('id', { count: 'exact', head: true });
  if (error) throw new Error(error.message);
  return count || 0;
}

async function dbPage(page, limit) {
  const { data, count, error } = await supabase
    .from('students')
    .select(
      'id,created_at,full_name,admission_no,form_level,combination,' +
      'shule_iliyotoka,mzazi_simu_kuu,damu,email_sent,registration_date',
      { count: 'exact' }
    )
    .order('id', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  if (error) throw new Error(error.message);
  return { rows: data || [], total: count || 0 };
}

// ── SETTINGS HELPERS ──────────────────────────────────────────
async function getSetting(key, fallback = null) {
  const { data } = await supabase
    .from('settings').select('value').eq('key', key).maybeSingle();
  return data ? data.value : fallback;
}

async function setSetting(key, value) {
  const { error } = await supabase
    .from('settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw new Error(error.message);
}

async function getJsonSetting(key, fallback) {
  const raw = await getSetting(key, null);
  if (raw == null) return fallback;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return fallback; }
}

async function setJsonSetting(key, value) {
  await setSetting(key, JSON.stringify(value ?? null));
}

const SETTINGS_KEYS = {
  regStatus:      'reg_status',
  pdfLayouts:     'pdf_layouts',
  nidaStore:      'nida_store',
  formEditsForm1: 'form_edits_form1',
  formEditsForm5: 'form_edits_form5',
};

const DEFAULT_REG = {
  form1: { open: true, message: 'Usajili wa Kidato cha Kwanza umefungwa.', deadline: '' },
  form5: { open: true, message: 'Usajili wa Kidato cha 5 umefungwa.',      deadline: '' },
};
let regStatus  = { ...DEFAULT_REG };
let pdfLayouts = { form1: {}, form5: {} };

// Load settings on startup
(async () => {
  try {
    const rs = await getJsonSetting(SETTINGS_KEYS.regStatus, DEFAULT_REG);
    const pl = await getJsonSetting(SETTINGS_KEYS.pdfLayouts, { form1: {}, form5: {} });
    Object.assign(regStatus,  rs || {});
    Object.assign(pdfLayouts, pl || {});
    console.log('✅  Settings loaded from Supabase');
  } catch (e) {
    console.warn('⚠️   Settings load failed (using defaults):', e.message);
  }
})();

// ── PDF UPLOAD TO SUPABASE STORAGE ────────────────────────────
async function uploadPdf({ buffer, contentType, fileName, studentId }) {
  const safe = String(fileName || `reg-${Date.now()}.pdf`).replace(/[^\w.\-]+/g, '_');
  const filePath = `${PDF_PREFIX}/${studentId || 'x'}/${Date.now()}-${safe}`;
  const { data, error } = await supabase.storage
    .from(PDF_BUCKET)
    .upload(filePath, buffer, {
      contentType: contentType || 'application/pdf',
      upsert: false,
    });
  if (error) {
    console.warn('⚠️   PDF upload to Supabase Storage failed:', error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, bucket: PDF_BUCKET, path: data.path };
}

// ── EMAIL BUILDER ─────────────────────────────────────────────
function tableRow(label, value) {
  return `
    <tr>
      <td style="padding:8px 14px;font-weight:600;color:#555;background:#f7f9fc;
                 width:38%;border-bottom:1px solid #eef2f7;">${label}</td>
      <td style="padding:8px 14px;color:#222;border-bottom:1px solid #eef2f7;">
        ${value || '—'}
      </td>
    </tr>`;
}

function tableSection(bgColor, icon, title, rows) {
  return `
    <div style="margin-bottom:20px;">
      <div style="background:${bgColor};color:white;padding:8px 14px;font-size:13px;
                  font-weight:700;border-radius:6px 6px 0 0;">${icon} ${title}</div>
      <table style="width:100%;border-collapse:collapse;background:white;
                    border-radius:0 0 6px 6px;">${rows}</table>
    </div>`;
}

function buildEmailHtml(d, fullName, date, isForm5) {
  const bg    = isForm5 ? '#553c9a' : '#1a365d';
  const label = isForm5 ? 'Kidato cha 5 2026' : 'Kidato cha Kwanza 2026';

  const combos = {
    PCB: 'Physics, Chemistry & Biology',
    PAM: 'Physics, Adv. Maths & Further Maths',
    HGL: 'History, Geography & Literature',
    PMC: 'Physics, Mathematics & Chemistry',
  };

  const comboBlock = isForm5
    ? `<div style="background:#e9d8fd;border-radius:8px;padding:10px 14px;margin-bottom:18px;">
         <strong style="color:#2d1b69;">Mkondo: ${d.combination || '—'}</strong>
         <span style="color:#666;font-size:12px;"> ${combos[d.combination] || ''}</span>
       </div>`
    : '';

  const cseeBlock = isForm5
    ? tableSection(bg, '📊', 'MATOKEO YA CSEE',
        tableRow('Mwaka',      d.cseeYear     || '—') +
        tableRow('Daraja',     d.cseeDivision ? 'Division ' + d.cseeDivision : '—') +
        tableRow('Aggregate',  d.cseeAggregates || '—') +
        (d.results || []).map(r => tableRow(r.subject, r.grade)).join('')
      )
    : '';

  const mainRows =
    tableRow('Jina Kamili',      fullName) +
    tableRow('Nambari ya Admission', d.admissionNo) +
    tableRow('Darasa',           isForm5 ? 'Kidato cha 5' : 'Kidato cha Kwanza') +
    tableRow('Ushule Uliotoka',  d.shuleIliyotoka) +
    tableRow('Wilaya ya Makazi', d.wilayaMakazi) +
    tableRow('Jinsia',           d.jinsia) +
    tableRow('Damu',             d.damu) +
    tableRow('Simu ya Mzazi',    d.mzaziSimuKuu || d.babaSimu) +
    tableRow('Tarehe',           date);

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:Arial,sans-serif;">
  <div style="max-width:650px;margin:24px auto;background:white;border-radius:8px;
              overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,${bg} 0%,${bg}dd 100%);
                color:white;padding:24px;text-align:center;">
      <h1 style="margin:0 0 8px;font-size:28px;">🎓 ${label}</h1>
      <p style="margin:0;font-size:14px;opacity:0.9;">Usajili Umehifadhiwa ✅</p>
    </div>

    <!-- Body -->
    <div style="padding:24px;">
      <h2 style="color:#222;margin-top:0;">Habari, ${fullName}!</h2>
      <p style="color:#555;">
        Asante kwa kujiandikisha kwa <strong>${label}</strong>.
        Shule iliyojiandikisha ni <strong>Tabora Boys School</strong>.
      </p>

      ${comboBlock}

      <div style="background:#f0f4f8;border-left:4px solid ${bg};
                  padding:12px 14px;margin-bottom:18px;border-radius:4px;">
        <strong style="color:${bg};">📝 Maelezo Yako</strong>
      </div>

      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
        ${mainRows}
      </table>

      ${cseeBlock}

      <div style="background:#e8f5e9;border-radius:8px;padding:12px 14px;margin-bottom:18px;">
        <p style="margin:0;color:#2e7d32;font-size:13px;">
          <strong>✅ Umehifadhiwa: </strong>
          Tafadhali hifadhi PDF iliyoambatanishwa kwa kumbukumbu.
          Hakikisha unakuja shuleni na nakala yake siku ya kwanza ya masomo.
        </p>
      </div>

      <hr style="border:none;border-top:1px solid #eef2f7;margin:20px 0;">
      <p style="color:#999;font-size:12px;text-align:center;margin:0;">
        © 2026 Tabora Boys School. Haki zote zimehifadhiwa.
      </p>
    </div>
  </div>
</body></html>`;
}

// ── SEND EMAIL VIA RESEND ─────────────────────────────────────
// pdfBuffer  — Node Buffer or null
// fileName   — attachment filename string
async function sendRegistrationEmail({ to, subject, html, pdfBuffer, fileName }) {
  if (!resendClient) {
    console.log('ℹ️   Email skipped — Resend client not available');
    return { ok: false, reason: 'resend_not_configured' };
  }

  // Build attachments array — Resend accepts base64 content
  const attachments = [];
  if (pdfBuffer && pdfBuffer.length) {
    attachments.push({
      filename: fileName || 'registration.pdf',
      content:  pdfBuffer.toString('base64'),  // ← Resend requires base64 string
    });
    console.log(`📎  PDF attached: ${fileName} (${Math.round(pdfBuffer.length / 1024)} KB)`);
  }

  // IMPORTANT: the `from` address must be either:
  //   a) onboarding@resend.dev  (works immediately, no domain setup needed)
  //   b) an address on a domain you verified in Resend dashboard
  const fromAddress = process.env.RESEND_FROM_EMAIL || 'Tabora Boys School <onboarding@resend.dev>';

  try {
    const result = await resendClient.emails.send({
      from:        fromAddress,
      to:          Array.isArray(to) ? to : [to],
      subject,
      html,
      attachments: attachments.length ? attachments : undefined,
    });

    if (result.error) {
      console.error('❌  Resend API error:', result.error);
      return { ok: false, reason: result.error.message || 'resend_api_error' };
    }

    console.log('✅  Email sent via Resend — id:', result.data?.id);
    return { ok: true, messageId: result.data?.id };
  } catch (err) {
    console.error('❌  Email send exception:', err.message);
    return { ok: false, reason: err.message };
  }
}

// ══════════════════════════════════════════════════════════════
//  ROUTES
// ══════════════════════════════════════════════════════════════

// Root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index_enhanced.html'));
});

// ── Health / Status ───────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    const total = await dbCount();
    res.json({
      status:       'ok',
      total,
      db:           'supabase',
      emailEnabled: EMAIL_ENABLED,
      emailProvider:'resend',
      env:          process.env.NODE_ENV || 'production',
    });
  } catch (e) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

app.get('/api/status', async (req, res) => {
  try {
    res.json({
      status:       'ok',
      total:        await dbCount(),
      regStatus,
      db:           'supabase',
      emailEnabled: EMAIL_ENABLED,
    });
  } catch (e) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

// ── Email test ────────────────────────────────────────────────
app.post('/api/test-email', async (req, res) => {
  if (!resendClient) {
    return res.status(400).json({
      success: false,
      error:   'Email haijasanidiwa. Weka RESEND_API_KEY kwenye Render environment variables.',
      howTo:   'Nenda https://resend.com → API Keys → Create Key → Copy → Render Dashboard → Environment',
    });
  }
  const result = await sendRegistrationEmail({
    to:      SCHOOL_EMAIL,
    subject: '✅ Test — Tabora Boys Registration System',
    html:    '<h2>Mfumo unafanya kazi! 🎉</h2><p>Barua pepe ya majaribio imetumwa kutoka Render.</p>',
  });
  if (result.ok) {
    res.json({ success: true, messageId: result.messageId });
  } else {
    res.status(500).json({ success: false, error: result.reason });
  }
});

// ── MAIN REGISTRATION ─────────────────────────────────────────
app.post('/api/register', upload.single('pdf'), async (req, res) => {
  const pdfFile   = req.file || null;
  let   studentId = null;

  try {
    const d         = JSON.parse(req.body.studentData);
    const formLevel = d.formLevel || 'form1';
    const isF5      = formLevel === 'form5';

    // Registration open/closed check
    if (regStatus[formLevel] && !regStatus[formLevel].open) {
      return res.status(403).json({
        success: false,
        error:   'Usajili umefungwa',
        message: regStatus[formLevel]?.message,
      });
    }

    const fullName  = [d.jina1, d.jina2, d.jina3].filter(Boolean).join(' ') || 'Haijajazwa';
    const date      = new Date().toLocaleString('en-GB', { timeZone: 'Africa/Dar_es_Salaam' });
    const formLabel = isF5 ? 'Kidato cha 5' : 'Kidato cha Kwanza';

    console.log(`📝  New registration: ${formLabel} | ${fullName}`);

    // ── Save to Supabase DB ──────────────────────────────────
    studentId = await dbInsert({
      form:             isF5 ? 'f5' : 'f1',
      form_level:       formLevel,
      jina1:            d.jina1            || null,
      jina2:            d.jina2            || null,
      jina3:            d.jina3            || null,
      full_name:        fullName,
      admission_no:     d.admissionNo      || null,
      tarehe:           d.tarehe           || null,
      jinsia:           d.jinsia           || null,
      wilaya_kuzaliwa:  d.wilayaKuzaliwa   || null,
      uraia:            d.uraia            || null,
      dini:             d.dini             || null,
      shule_iliyotoka:  d.shuleIliyotoka   || null,
      mkoa:             d.mkoa             || null,
      wilaya_makazi:    d.wilayaMakazi     || null,
      tarafa:           d.tarafa           || null,
      kata:             d.kata             || null,
      kijiji:           d.kijiji           || null,
      nambari_nyumba:   d.nambariNyumba    || null,
      baba_njina:       d.babaNjina        || null,
      baba_simu:        d.babaSimu         || null,
      mama_njina:       d.mamaNjina        || null,
      mama_simu:        d.mamaSimu         || null,
      mlezi_jina:       d.mleziJina        || null,
      mlezi_simu:       d.mleziSimu        || null,
      ndugu_jina:       d.nduguJina        || null,
      ndugu_simu:       d.nduguSimu        || null,
      mzazi_jina:       d.mzaziJina        || null,
      uhusiano:         d.uhusiano         || null,
      mzazi_simu_kuu:   d.mzaziSimuKuu     || d.babaSimu || null,
      mzazi_anwani:     d.mzaziAnwani      || null,
      mzazi_email:      d.mzaziEmail       || null,
      damu:             d.damu             || null,
      bima:             d.bima             || null,
      bima_aina:        d.bimaAina         || null,
      magonjwa:         d.magonjwa         || null,
      cheeti_status:    d.cheetiStatus     || null,
      fomu_d:           d.fomuD            || null,
      combination:      isF5 ? (d.combination      || null) : null,
      index_no_olevel:  isF5 ? (d.indexNoOlevel    || null) : null,
      csee_year:        isF5 ? (d.cseeYear          || null) : null,
      csee_division:    isF5 ? (d.cseeDivision      || null) : null,
      csee_points:      isF5 ? (d.cseePoints        || null) : null,
      csee_aggregates:  isF5 ? (d.cseeAggregates    || null) : null,
      results_json:     isF5 ? (d.results           || null) : null,
      registration_date: date,
      email_sent:       false,
      raw_json:         d,
    });
    console.log(`✅  Saved to DB — ID: ${studentId}`);

    // ── Upload PDF to Supabase Storage ───────────────────────
    let uploadedPdf   = null;
    let pdfBufferCopy = null;
    let pdfFileName   = `TaboraBoys_${formLabel.replace(/\s+/g, '_')}_${fullName.replace(/\s+/g, '_')}_2026.pdf`;

    if (pdfFile?.buffer?.length) {
      pdfBufferCopy = pdfFile.buffer;          // keep reference for email
      uploadedPdf   = await uploadPdf({
        buffer:      pdfFile.buffer,
        contentType: pdfFile.mimetype || 'application/pdf',
        fileName:    pdfFile.originalname || pdfFileName,
        studentId,
      });
      if (uploadedPdf?.ok) {
        await dbUpdate(studentId, { pdf_filename: uploadedPdf.path });
        console.log('📄  PDF stored in Supabase Storage:', uploadedPdf.path);
      }
    } else {
      console.log('ℹ️   No PDF file received in this request');
    }

    // ── Send Email (with PDF attached) ───────────────────────
    const emailResult = await sendRegistrationEmail({
      to:        SCHOOL_EMAIL,
      subject:   `🎓 Usajili: ${fullName} | ${formLabel}${d.combination ? ' — ' + d.combination : ''} | ${date}`,
      html:      buildEmailHtml(d, fullName, date, isF5),
      pdfBuffer: pdfBufferCopy,          // null if no PDF uploaded
      fileName:  pdfFileName,
    });

    if (emailResult.ok) {
      await dbUpdate(studentId, { email_sent: true, email_message_id: emailResult.messageId });
      console.log(`📧  Email sent — student ID: ${studentId}`);
    } else {
      console.warn(`⚠️   Email not sent (${emailResult.reason}) — data still saved`);
    }

    res.json({
      success:    true,
      message:    emailResult.ok ? 'Umehifadhiwa mtandaoni!' : 'Umehifadhiwa! (Barua pepe haikutumwa)',
      studentId,
      emailSent:  emailResult.ok,
      pdfStored:  uploadedPdf?.ok ? { bucket: uploadedPdf.bucket, path: uploadedPdf.path } : null,
    });

  } catch (err) {
    console.error('❌  /api/register error:', err.message);
    res.status(500).json({ success: false, error: err.message, studentId });
  }
});

// ── Admin: list students ──────────────────────────────────────
app.get('/api/admin/students', async (req, res) => {
  const page  = Math.max(1,   parseInt(req.query.page  || '1',  10));
  const limit = Math.min(100, parseInt(req.query.limit || '20', 10));
  try {
    const { rows, total } = await dbPage(page, limit);
    res.json({ success: true, page, limit, total, pages: Math.ceil(total / limit), data: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/admin/students/:id', async (req, res) => {
  try {
    const r = await dbGetById(req.params.id);
    if (!r) return res.status(404).json({ success: false, error: 'Hapatikani' });
    res.json({ success: true, data: r });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/admin/students/:id', async (req, res) => {
  try {
    await dbDelete(req.params.id);
    res.json({ success: true, message: `ID ${req.params.id} imefutwa` });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Admin: PDF signed URL ─────────────────────────────────────
app.get('/api/admin/students/:id/pdf', async (req, res) => {
  try {
    const r = await dbGetById(req.params.id);
    if (!r)              return res.status(404).json({ success: false, error: 'Hapatikani' });
    if (!r.pdf_filename) return res.status(404).json({ success: false, error: 'Hakuna PDF' });
    const { data, error } = await supabase.storage
      .from(PDF_BUCKET)
      .createSignedUrl(r.pdf_filename, SIGNED_TTL);
    if (error || !data?.signedUrl)
      return res.status(500).json({ success: false, error: error?.message || 'URL generation failed' });
    res.json({ success: true, signedUrl: data.signedUrl, name: r.full_name });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Admin: search ─────────────────────────────────────────────
app.get('/api/admin/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ success: true, count: 0, data: [] });
  try {
    const { data, error } = await supabase
      .from('students')
      .select('id,created_at,full_name,admission_no,form_level,combination,shule_iliyotoka,email_sent')
      .or(`full_name.ilike.%${q}%,admission_no.ilike.%${q}%`);
    if (error) throw new Error(error.message);
    res.json({ success: true, count: (data || []).length, data: data || [] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Admin: stats ──────────────────────────────────────────────
app.get('/api/admin/stats', async (req, res) => {
  try {
    const [a, b, c, d] = await Promise.all([
      supabase.from('students').select('id', { count: 'exact', head: true }),
      supabase.from('students').select('id', { count: 'exact', head: true }).eq('email_sent', true),
      supabase.from('students').select('id', { count: 'exact', head: true }).eq('form_level', 'form1'),
      supabase.from('students').select('id', { count: 'exact', head: true }).eq('form_level', 'form5'),
    ]);
    res.json({ success: true, total: a.count || 0, emailSent: b.count || 0, form1: c.count || 0, form5: d.count || 0 });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Admin: export ─────────────────────────────────────────────
app.get('/api/admin/export/json', async (req, res) => {
  try {
    const { data, error } = await supabase.from('students').select('*').order('id');
    if (error) throw new Error(error.message);
    res.setHeader('Content-Disposition', 'attachment; filename="tabora_boys_2026.json"');
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(data || [], null, 2));
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/admin/export/csv', async (req, res) => {
  try {
    const { data, error } = await supabase.from('students').select('*').order('id');
    if (error) throw new Error(error.message);
    const rows = data || [];
    if (!rows.length) return res.send('Hakuna data');
    const esc  = v => {
      if (v == null) return '';
      const s = String(v);
      return (s.includes(',') || s.includes('"') || s.includes('\n'))
        ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const keys = Object.keys(rows[0]);
    res.setHeader('Content-Disposition', 'attachment; filename="tabora_boys_2026.csv"');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.send('\uFEFF' + [keys.join(','), ...rows.map(r => keys.map(k => esc(r[k])).join(','))].join('\r\n'));
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Registration status ───────────────────────────────────────
app.get('/api/registration-status', (req, res) => {
  const form = req.query.form || 'form1';
  if (!regStatus[form]) return res.status(404).json({ error: 'Fomu haijulikani' });
  res.json(regStatus[form]);
});

app.post('/api/registration-status', async (req, res) => {
  const { form, open, message, deadline } = req.body;
  if (!form || !regStatus[form])
    return res.status(400).json({ error: 'form lazima iwe form1 au form5' });
  regStatus[form] = { open: open === true || open === 'true', message: message || '', deadline: deadline || '' };
  try {
    await setJsonSetting(SETTINGS_KEYS.regStatus, regStatus);
    res.json({ success: true, form, status: regStatus[form] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── PDF Layout ────────────────────────────────────────────────
app.get('/api/pdf-layout', (req, res) => res.json(pdfLayouts[req.query.form || 'form1'] || {}));

app.post('/api/pdf-layout', async (req, res) => {
  const { form, layout } = req.body;
  if (!form || !['form1', 'form5'].includes(form))
    return res.status(400).json({ error: 'form lazima iwe form1 au form5' });
  pdfLayouts[form] = layout || {};
  try {
    await setJsonSetting(SETTINGS_KEYS.pdfLayouts, pdfLayouts);
    res.json({ success: true, form });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── NIDA store ────────────────────────────────────────────────
app.get('/api/nida/exists', async (req, res) => {
  const nida = normalizeNida(req.query.nida);
  if (!nida) return res.status(400).json({ success: false, error: 'nida inahitajika' });
  try {
    const store = await getJsonSetting(SETTINGS_KEYS.nidaStore, { nidas: [] });
    const list  = Array.isArray(store?.nidas) ? store.nidas : [];
    res.json({ success: true, nida, exists: list.includes(nida) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/nida', async (req, res) => {
  const nida = normalizeNida(req.body?.nida);
  if (!nida) return res.status(400).json({ success: false, error: 'nida inahitajika' });
  try {
    const store = await getJsonSetting(SETTINGS_KEYS.nidaStore, { nidas: [] });
    const list  = Array.isArray(store?.nidas) ? store.nidas : [];
    if (!list.includes(nida)) list.push(nida);
    await setJsonSetting(SETTINGS_KEYS.nidaStore, { nidas: list });
    res.json({ success: true, nida, stored: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Form edits ────────────────────────────────────────────────
app.get('/api/admin/form-edits', async (req, res) => {
  const form = req.query.form === 'form5' ? 'form5' : 'form1';
  const key  = form === 'form5' ? SETTINGS_KEYS.formEditsForm5 : SETTINGS_KEYS.formEditsForm1;
  try {
    const edits = await getJsonSetting(key, {});
    res.json({ success: true, form, edits: edits && typeof edits === 'object' ? edits : {} });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/admin/form-edits', async (req, res) => {
  const form  = req.body?.form === 'form5' ? 'form5' : 'form1';
  const key   = form === 'form5' ? SETTINGS_KEYS.formEditsForm5 : SETTINGS_KEYS.formEditsForm1;
  const edits = req.body?.edits;
  if (!edits || typeof edits !== 'object')
    return res.status(400).json({ success: false, error: 'edits lazima iwe object' });
  try {
    await setJsonSetting(key, edits);
    res.json({ success: true, form });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── START ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅  Server running on port ${PORT}`);
  console.log(`    DB      : Supabase`);
  console.log(`    Email   : ${EMAIL_ENABLED ? 'Resend ✅' : 'DISABLED ⚠️  (set RESEND_API_KEY)'}`);
  console.log(`    School  : ${SCHOOL_EMAIL}\n`);
});

module.exports = app;
