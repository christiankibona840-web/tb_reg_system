'use strict';

const express          = require('express');
const nodemailer       = require('nodemailer');
const cors             = require('cors');
const multer           = require('multer');
const path             = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// At the bottom, just before app.listen()
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index_enhanced.html'));
});
// Catch-all for any unmatched route (also prevents 404 on refresh)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index_enhanced.html'));
});

// ================================================================
//  STARTUP CHECKS — fails fast with a clear message if keys missing
// ================================================================
const REQUIRED = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SMTP_USER',
  'SMTP_PASS',
  'SCHOOL_EMAIL',
];
const MISSING = REQUIRED.filter(k => !process.env[k]);
if (MISSING.length) {
  console.error('\n❌  Cannot start — missing environment variables:');
  MISSING.forEach(k => console.error(`     • ${k}`));
  console.error('\n   Add them in Railway → your project → Variables tab.\n');
  process.exit(1);
}

// ================================================================
//  CONSTANTS  — every value from env, nothing hardcoded
// ================================================================
const PORT           = process.env.PORT                    || 5000;
const SCHOOL_EMAIL   = process.env.SCHOOL_EMAIL;
const FRONTEND_URL   = process.env.FRONTEND_URL            || '*';
const PDF_BUCKET     = process.env.SUPABASE_PDF_BUCKET     || 'registrations';
const PDF_PREFIX     = process.env.SUPABASE_PDF_PREFIX     || 'pdfs';
const SIGNED_URL_TTL = parseInt(process.env.SIGNED_URL_TTL || '3600', 10);

// ================================================================
//  SUPABASE  — single online database, no local fallback
// ================================================================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// Quick connectivity check at startup
supabase.from('students').select('id', { count: 'exact', head: true })
  .then(({ error }) => {
    if (error) console.error('⚠️  Supabase connectivity issue:', error.message);
    else        console.log('✅  Supabase connected');
  });

// ================================================================
//  NODEMAILER
// ================================================================
const mailer = nodemailer.createTransport({
  service: process.env.SMTP_SERVICE || 'gmail',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,      // Gmail App Password
  },
});
mailer.verify(err => {
  if (err) console.error('⚠️  Email not ready:', err.message);
  else     console.log('✅  Email ready →', process.env.SMTP_USER);
});

// ================================================================
//  EXPRESS  +  MIDDLEWARE
// ================================================================
const app    = express();
const upload = multer({ storage: multer.memoryStorage() });

// CORS — allow your Vercel frontend + VS Code Live Server for dev
const ALLOWED_ORIGINS = [
  FRONTEND_URL,
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:3000',
].filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    // Requests with no origin (Postman, curl, mobile) — allow
    if (!origin) return cb(null, true);
    // Wildcard — allow everything (dev fallback)
    if (FRONTEND_URL === '*') return cb(null, true);
    // Check against allowed list
    if (ALLOWED_ORIGINS.some(o => origin.startsWith(o))) return cb(null, true);
    console.warn('🚫 CORS blocked:', origin);
    cb(new Error(`Origin ${origin} not allowed`));
  },
  methods:     ['GET', 'POST', 'DELETE', 'OPTIONS'],
  credentials: true,
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ================================================================
//  SUPABASE HELPERS
// ================================================================

// ── Students ────────────────────────────────────────────────────
async function insertStudent(row) {
  const { data, error } = await supabase
    .from('students').insert(row).select('id').single();
  if (error) throw new Error(`DB insert failed: ${error.message}`);
  return data.id;
}

async function updateStudent(id, patch) {
  const { error } = await supabase
    .from('students').update(patch).eq('id', id);
  if (error) throw new Error(`DB update failed: ${error.message}`);
}

async function getStudentById(id) {
  const { data, error } = await supabase
    .from('students').select('*').eq('id', id).single();
  if (error) return null;
  return data;
}

async function deleteStudent(id) {
  const { error } = await supabase
    .from('students').delete().eq('id', id);
  if (error) throw new Error(`DB delete failed: ${error.message}`);
}

async function getStudentsPage(page, limit) {
  const from = (page - 1) * limit;
  const { data, count, error } = await supabase
    .from('students')
    .select(
      'id,created_at,full_name,admission_no,form_level,combination,' +
      'shule_iliyotoka,mzazi_simu_kuu,damu,email_sent,registration_date',
      { count: 'exact' }
    )
    .order('id', { ascending: false })
    .range(from, from + limit - 1);
  if (error) throw new Error(`DB page failed: ${error.message}`);
  return { rows: data || [], total: count || 0 };
}

// ── Settings (reg_status, pdf_layouts, form_edits) ────────────
async function getSetting(key, fallback = null) {
  const { data, error } = await supabase
    .from('settings').select('value').eq('key', key).maybeSingle();
  if (error || !data) return fallback;
  return data.value;
}

async function setSetting(key, value) {
  const { error } = await supabase
    .from('settings')
    .upsert(
      { key, value, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
  if (error) throw new Error(`Settings save failed: ${error.message}`);
}

// ── PDF Storage ─────────────────────────────────────────────────
async function uploadPdf({ buffer, contentType, fileName, studentId }) {
  const safe = String(fileName || `reg-${Date.now()}.pdf`)
    .replace(/[^\w.\-]+/g, '_');
  const objectPath = `${PDF_PREFIX}/${studentId}/${Date.now()}-${safe}`;

  const { data, error } = await supabase.storage
    .from(PDF_BUCKET)
    .upload(objectPath, buffer, {
      contentType: contentType || 'application/pdf',
      upsert: false,
    });

  if (error) return { ok: false, error: error.message };
  return { ok: true, bucket: PDF_BUCKET, path: data.path };
}

// ── In-memory cache (loaded from Supabase on boot) ─────────────
let regStatus  = {
  form1: { open: true, message: 'Usajili umefungwa.', deadline: '' },
  form5: { open: true, message: 'Usajili umefungwa.', deadline: '' },
};
let pdfLayouts = { form1: {}, form5: {} };

(async () => {
  try {
    const [rs, pl] = await Promise.all([
      getSetting('reg_status',  regStatus),
      getSetting('pdf_layouts', pdfLayouts),
    ]);
    if (rs) Object.assign(regStatus,  rs);
    if (pl) Object.assign(pdfLayouts, pl);
    console.log('✅  Settings loaded from Supabase');
  } catch (e) {
    console.warn('⚠️   Settings load failed (defaults used):', e.message);
  }
})();

// ================================================================
//  EMAIL BUILDERS
// ================================================================
function row(l, v) {
  return `<tr>
    <td style="padding:8px 14px;font-weight:600;color:#555;background:#f7f9fc;
               width:38%;border-bottom:1px solid #eef2f7;">${l}</td>
    <td style="padding:8px 14px;color:#1a1a2e;border-bottom:1px solid #eef2f7;">
      ${v || '—'}
    </td>
  </tr>`;
}
function section(color, icon, title, rows) {
  return `
  <div style="margin-bottom:20px;">
    <div style="background:${color};color:white;padding:8px 14px;font-size:13px;
                font-weight:700;border-radius:6px 6px 0 0;">${icon} ${title}</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;
                  border:1px solid #dde3ed;border-top:none;">${rows}</table>
  </div>`;
}

function buildForm1Email(d, fullName, date) {
  const dob = [d.tarehe, d.mwezi, d.mwaka].filter(Boolean).join('/');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;background:#f0f4f8;font-family:Arial,sans-serif;">
<div style="max-width:650px;margin:24px auto;background:#fff;border-radius:12px;
            overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1);">

  <div style="background:linear-gradient(135deg,#0d1f3c,#1a365d);padding:28px 32px;">
    <div style="color:white;font-size:17px;font-weight:800;">
      🏫 SHULE YA SEKONDARI TABORA WAVULANA
    </div>
    <div style="color:#f0c84a;font-size:11px;margin-top:3px;font-weight:600;">
      Usajili Mpya — Kidato cha Kwanza 2026
    </div>
  </div>

  <div style="height:4px;background:linear-gradient(90deg,#c8962a,#f0c84a,#c8962a);"></div>

  <div style="padding:16px 28px;background:#e8f5e9;border-left:4px solid #2d6a4f;">
    <strong style="color:#1b5e20;">✅ Mwanafunzi Mpya — ${date}</strong>
  </div>

  <div style="padding:24px 28px;">
    ${section('#1a365d','👤','TAARIFA ZA KIBINAFSI',
      row('Jina Kamili', `<strong style="color:#1a365d;">${fullName}</strong>`) +
      row('Tarehe ya Kuzaliwa', dob) +
      row('Wilaya ya Kuzaliwa', d.wilayaKuzaliwa) +
      row('Uraia', d.uraia) +
      row('Dini', d.dini) +
      row('Shule Iliyotoka', d.shuleIliyotoka) +
      row('Namba Usajili', d.admissionNo || '—') +
      row('Mkoa / Wilaya', [d.mkoa, d.wilayaMakazi].filter(Boolean).join(' / ')) +
      row('Kata / Kijiji',  [d.kata, d.kijiji].filter(Boolean).join(' / '))
    )}
    ${section('#2c5282','👨‍👩‍👦','FAMILIA',
      row('Baba',  d.babaNjina) +
      row('Simu ya Baba', d.babaSimu) +
      row('Mama',  d.mamaNjina) +
      row('Simu ya Mama', d.mamaSimu) +
      row('Mlezi', [d.mleziJina, d.mleziSimu].filter(Boolean).join(' — ')) +
      row('Ndugu', [d.nduguJina, d.nduguSimu].filter(Boolean).join(' — '))
    )}
    ${section('#276749','🤝','MZAZI / MLEZI MKUU',
      row('Jina', `<strong>${d.mzaziJina}</strong>`) +
      row('Uhusiano', d.uhusiano) +
      row('Simu', `<strong style="color:#2b5fa5;">${d.mzaziSimuKuu || d.babaSimu}</strong>`) +
      row('Barua Pepe', d.mzaziEmail || 'Haitolewa') +
      row('Anwani', d.mzaziAnwani)
    )}
    ${section('#c53030','🏥','AFYA',
      row('Kundi la Damu', `<strong style="color:#c0392b;">${d.damu}</strong>`) +
      row('Bima', d.bima) +
      row('Aina ya Bima', d.bimaAina) +
      row('Magonjwa', d.magonjwa || 'Hakuna')
    )}
  </div>

  <div style="background:#f7f9fc;padding:16px 28px;text-align:center;
              font-size:11px;color:#888;">
    <strong style="color:#1a365d;">Shule ya Sekondari Tabora Wavulana</strong><br>
    S.L.P 374, Tabora · Simu: 0755 297 005
  </div>
</div>
</body></html>`;
}

function buildForm5Email(d, fullName, date) {
  const COMBOS = {
    PCB: 'Physics, Chemistry & Biology',
    PAM: 'Physics, Advanced Mathematics & Further Mathematics',
    HGL: 'History, Geography & Literature',
    PMC: 'Physics, Mathematics & Chemistry',
  };
  const resultsRows = (d.results || [])
    .map(r => row(r.subject, `${r.grade} (${r.points} pts)`))
    .join('') || row('Matokeo', 'Hayakuingizwa');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;background:#f0f4f8;font-family:Arial,sans-serif;">
<div style="max-width:650px;margin:24px auto;background:#fff;border-radius:12px;
            overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1);">

  <div style="background:linear-gradient(135deg,#2d1b69,#553c9a);padding:28px 32px;">
    <div style="color:white;font-size:17px;font-weight:800;">
      🏫 SHULE YA SEKONDARI TABORA WAVULANA
    </div>
    <div style="color:#e9d8fd;font-size:11px;margin-top:3px;font-weight:600;">
      Usajili Mpya — Kidato cha 5 · 2026
    </div>
  </div>

  <div style="height:4px;background:linear-gradient(90deg,#553c9a,#e9d8fd,#553c9a);"></div>

  <div style="padding:16px 28px;background:#faf5ff;border-left:4px solid #553c9a;">
    <strong style="color:#2d1b69;">
      ✅ ${fullName} | Mkondo: ${d.combination || '—'} — ${date}
    </strong>
  </div>

  <div style="padding:24px 28px;">
    <div style="background:#e9d8fd;border-radius:8px;padding:12px 16px;margin-bottom:20px;">
      <strong style="color:#2d1b69;font-size:16px;">Mkondo: ${d.combination || '—'}</strong>
      <span style="color:#553c9a;font-size:12px;margin-left:8px;">
        ${COMBOS[d.combination] || ''}
      </span>
    </div>

    ${section('#553c9a','👤','TAARIFA ZA KIBINAFSI',
      row('Jina Kamili', `<strong>${fullName}</strong>`) +
      row('Tarehe ya Kuzaliwa', d.tarehe || '—') +
      row('Uraia', d.uraia) +
      row('Dini',  d.dini) +
      row('Shule ya O-Level', d.shuleIliyotoka) +
      row('Index No (O-Level)', d.indexNoOlevel || '—') +
      row('Namba Usajili', d.admissionNo || '—')
    )}
    ${section('#553c9a','📊','MATOKEO YA CSEE',
      row('Mwaka wa CSEE', d.cseeYear || '—') +
      row('Daraja', d.cseeDivision ? `Division ${d.cseeDivision}` : '—') +
      row('Aggregate', d.cseeAggregates || '—') +
      resultsRows
    )}
    ${section('#553c9a','🏠','MAKAZI',
      row('Mkoa / Wilaya', [d.mkoa, d.wilayaMakazi].filter(Boolean).join(' / ')) +
      row('Kata / Kijiji',  [d.kata, d.kijiji].filter(Boolean).join(' / '))
    )}
    ${section('#553c9a','👨‍👩‍👦','FAMILIA',
      row('Baba',  d.babaNjina) +
      row('Simu ya Baba', d.babaSimu) +
      row('Mama',  d.mamaNjina) +
      row('Simu ya Mama', d.mamaSimu) +
      row('Mlezi', [d.mleziJina, d.mleziSimu].filter(Boolean).join(' — '))
    )}
  </div>

  <div style="background:#f7f9fc;padding:16px 28px;text-align:center;
              font-size:11px;color:#888;">
    <strong style="color:#553c9a;">Shule ya Sekondari Tabora Wavulana</strong><br>
    S.L.P 374, Tabora · Simu: 0755 297 005
  </div>
</div>
</body></html>`;
}

// ================================================================
//  ROUTES
// ================================================================

// ── Health / Status ─────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
  try {
    const { count } = await supabase
      .from('students').select('id', { count: 'exact', head: true });
    res.json({ status: 'ok', total: count || 0, db: 'supabase' });
  } catch (e) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

// Used by shudi.html + form5.html to check online status
app.get('/api/status', async (_req, res) => {
  try {
    const { count } = await supabase
      .from('students').select('id', { count: 'exact', head: true });
    res.json({ status: 'ok', total_registrations: count || 0, regStatus, db: 'supabase' });
  } catch (e) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

// ── Test Email ──────────────────────────────────────────────────
app.post('/api/test-email', async (_req, res) => {
  try {
    const info = await mailer.sendMail({
      from:    `"Tabora Boys" <${process.env.SMTP_USER}>`,
      to:      SCHOOL_EMAIL,
      subject: '✅ Test — Mfumo wa Barua Pepe Unafanya Kazi',
      html:    '<p>Mfumo wa barua pepe unafanya kazi vizuri!</p>',
    });
    res.json({ success: true, messageId: info.messageId });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Register Student (Form 1 & Form 5) ─────────────────────────
app.post('/api/register', upload.single('pdf'), async (req, res) => {
  let studentId = null;
  try {
    const d         = JSON.parse(req.body.studentData);
    const formLevel = d.formLevel || 'form1';

    // Block if registration is closed
    if (regStatus[formLevel] && !regStatus[formLevel].open) {
      return res.status(403).json({
        success: false,
        error:   'Usajili umefungwa',
        message: regStatus[formLevel].message || 'Usajili umefungwa kwa sasa.',
      });
    }

    const fullName   = [d.jina1, d.jina2, d.jina3].filter(Boolean).join(' ') || 'Haijajazwa';
    const submitDate = new Date().toLocaleString('en-GB', { timeZone: 'Africa/Dar_es_Salaam' });
    const formLabel  = formLevel === 'form5' ? 'Kidato cha 5' : 'Kidato cha Kwanza';

    console.log(`📥  ${formLabel} | ${fullName}`);

    // ── Save to Supabase ───────────────────────────────────────
    studentId = await insertStudent({
      form:              formLevel === 'form5' ? 'f5' : 'f1',
      form_level:        formLevel,
      jina1:             d.jina1            || null,
      jina2:             d.jina2            || null,
      jina3:             d.jina3            || null,
      full_name:         fullName,
      admission_no:      d.admissionNo      || null,
      tarehe:            d.tarehe           || null,
      jinsia:            d.jinsia           || null,
      wilaya_kuzaliwa:   d.wilayaKuzaliwa   || null,
      uraia:             d.uraia            || null,
      dini:              d.dini             || null,
      shule_iliyotoka:   d.shuleIliyotoka   || null,
      mkoa:              d.mkoa             || null,
      wilaya_makazi:     d.wilayaMakazi     || null,
      tarafa:            d.tarafa           || null,
      kata:              d.kata             || null,
      kijiji:            d.kijiji           || null,
      nambari_nyumba:    d.nambariNyumba    || null,
      mwenyekiti_jina:   d.mwenyekitiJina   || null,
      mwenyekiti_simu:   d.mwenyekitiSimu   || null,
      mtendaji_jina:     d.mtendajiJina     || null,
      baba_njina:        d.babaNjina        || null,
      baba_simu:         d.babaSimu         || null,
      mama_njina:        d.mamaNjina        || null,
      mama_simu:         d.mamaSimu         || null,
      mlezi_jina:        d.mleziJina        || null,
      mlezi_simu:        d.mleziSimu        || null,
      ndugu_jina:        d.nduguJina        || null,
      ndugu_simu:        d.nduguSimu        || null,
      mzazi_jina:        d.mzaziJina        || null,
      uhusiano:          d.uhusiano         || null,
      mzazi_simu_kuu:    d.mzaziSimuKuu  || d.babaSimu || null,
      mzazi_anwani:      d.mzaziAnwani      || null,
      mzazi_email:       d.mzaziEmail       || null,
      damu:              d.damu             || null,
      bima:              d.bima             || null,
      bima_aina:         d.bimaAina         || null,
      magonjwa:          d.magonjwa         || null,
      cheeti_status:     d.cheetiStatus     || null,
      fomu_d:            d.fomuD            || null,
      // Form 5 specific
      combination:       formLevel === 'form5' ? (d.combination     || null) : null,
      index_no_olevel:   formLevel === 'form5' ? (d.indexNoOlevel   || null) : null,
      csee_year:         formLevel === 'form5' ? (d.cseeYear        || null) : null,
      csee_division:     formLevel === 'form5' ? (d.cseeDivision    || null) : null,
      csee_points:       formLevel === 'form5' ? (d.cseePoints      || null) : null,
      csee_aggregates:   formLevel === 'form5' ? (d.cseeAggregates  || null) : null,
      results_json:      formLevel === 'form5' ? (d.results         || null) : null,
      registration_date: submitDate,
      email_sent:        false,
      raw_json:          d,
    });

    console.log(`💾  Saved → Supabase ID: ${studentId}`);

    // ── Upload PDF to Supabase Storage ─────────────────────────
    const pdfFile     = req.file || null;
    const attachments = [];
    let   pdfResult   = null;

    if (pdfFile?.buffer?.length) {
      attachments.push({
        filename:    `TaboraBoys_${formLabel.replace(/\s+/g,'_')}_${fullName.replace(/\s+/g,'_')}.pdf`,
        content:     pdfFile.buffer,
        contentType: pdfFile.mimetype || 'application/pdf',
      });

      pdfResult = await uploadPdf({
        buffer:      pdfFile.buffer,
        contentType: pdfFile.mimetype,
        fileName:    pdfFile.originalname,
        studentId,
      });

      if (pdfResult.ok) {
        await updateStudent(studentId, { pdf_filename: pdfResult.path });
        console.log(`📄  PDF → Supabase: ${pdfResult.path}`);
      } else {
        console.warn('⚠️   PDF upload failed:', pdfResult.error);
      }
    }

    // ── Send Email Notification ────────────────────────────────
    const emailHtml = formLevel === 'form5'
      ? buildForm5Email(d, fullName, submitDate)
      : buildForm1Email(d, fullName, submitDate);

    const mail = await mailer.sendMail({
      from:        `"Tabora Boys Registration" <${process.env.SMTP_USER}>`,
      to:          SCHOOL_EMAIL,
      subject:     `🎓 Usajili Mpya: ${fullName} | ${formLabel} | ${submitDate}`,
      html:        emailHtml,
      attachments,
    });

    await updateStudent(studentId, {
      email_sent:        true,
      email_message_id:  mail.messageId,
    });

    console.log(`✅  Done — ID: ${studentId} | Email: ${mail.messageId}`);

    res.json({
      success:   true,
      message:   'Usajili umefanikiwa!',
      studentId,
      emailSent: true,
      pdfStored: pdfResult?.ok
        ? { bucket: pdfResult.bucket, path: pdfResult.path }
        : null,
    });

  } catch (err) {
    console.error('❌  Register error:', err.message);
    res.status(500).json({ success: false, error: err.message, studentId });
  }
});

// ── Admin: List Students ────────────────────────────────────────
app.get('/api/admin/students', async (req, res) => {
  const page  = Math.max(1,   parseInt(req.query.page  || '1',  10));
  const limit = Math.min(100, parseInt(req.query.limit || '20', 10));
  try {
    const { rows, total } = await getStudentsPage(page, limit);
    res.json({
      success: true, page, limit, total,
      pages: Math.ceil(total / limit), data: rows,
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Admin: Single Student ───────────────────────────────────────
app.get('/api/admin/students/:id', async (req, res) => {
  try {
    const row = await getStudentById(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: 'Hapatikani' });
    res.json({ success: true, data: row });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Admin: Search ───────────────────────────────────────────────
app.get('/api/admin/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ success: true, count: 0, data: [] });
  try {
    const { data, error } = await supabase
      .from('students')
      .select('id,created_at,full_name,admission_no,form_level,combination,shule_iliyotoka,mzazi_simu_kuu,email_sent')
      .or([
        `full_name.ilike.%${q}%`,
        `admission_no.ilike.%${q}%`,
        `shule_iliyotoka.ilike.%${q}%`,
        `baba_njina.ilike.%${q}%`,
        `mama_njina.ilike.%${q}%`,
      ].join(','))
      .order('id', { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    res.json({ success: true, count: (data || []).length, data: data || [] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Admin: Stats ────────────────────────────────────────────────
app.get('/api/admin/stats', async (_req, res) => {
  try {
    const [total, sent, f1, f5] = await Promise.all([
      supabase.from('students').select('id', { count: 'exact', head: true }),
      supabase.from('students').select('id', { count: 'exact', head: true }).eq('email_sent', true),
      supabase.from('students').select('id', { count: 'exact', head: true }).eq('form_level', 'form1'),
      supabase.from('students').select('id', { count: 'exact', head: true }).eq('form_level', 'form5'),
    ]);
    res.json({
      success: true,
      total:      total.count  || 0,
      emailSent:  sent.count   || 0,
      form1:      f1.count     || 0,
      form5:      f5.count     || 0,
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Admin: Summary ──────────────────────────────────────────────
app.get('/api/admin/summary', async (_req, res) => {
  try {
    const [total, f1, f5] = await Promise.all([
      supabase.from('students').select('id', { count: 'exact', head: true }),
      supabase.from('students').select('id', { count: 'exact', head: true }).eq('form_level', 'form1'),
      supabase.from('students').select('id', { count: 'exact', head: true }).eq('form_level', 'form5'),
    ]);
    res.json({
      success: true,
      total:  total.count || 0,
      form1:  f1.count    || 0,
      form5:  f5.count    || 0,
      regStatus,
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Admin: Filter by Form / Combo ──────────────────────────────
app.get('/api/admin/students/filter', async (req, res) => {
  const page  = Math.max(1,   parseInt(req.query.page  || '1',  10));
  const limit = Math.min(100, parseInt(req.query.limit || '20', 10));
  const { form, combo } = req.query;
  try {
    let q = supabase
      .from('students')
      .select(
        'id,created_at,full_name,admission_no,form_level,combination,' +
        'shule_iliyotoka,mzazi_simu_kuu,email_sent,registration_date',
        { count: 'exact' }
      )
      .order('id', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (form)  q = q.eq('form_level',  form);
    if (combo) q = q.eq('combination', combo);

    const { data, count, error } = await q;
    if (error) throw new Error(error.message);
    res.json({
      success: true, page, limit,
      total: count || 0,
      pages: Math.ceil((count || 0) / limit),
      data:  data  || [],
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Admin: Export JSON ──────────────────────────────────────────
app.get('/api/admin/export/json', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('students').select('*').order('id', { ascending: true });
    if (error) throw new Error(error.message);
    res.setHeader('Content-Disposition', 'attachment; filename="tabora_boys_2026.json"');
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(data || [], null, 2));
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Admin: Export CSV ───────────────────────────────────────────
app.get('/api/admin/export/csv', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('students').select('*').order('id', { ascending: true });
    if (error) throw new Error(error.message);
    const rows = data || [];
    if (!rows.length) return res.send('Hakuna data');

    const esc = v => {
      if (v == null) return '';
      const s = String(v);
      return (s.includes(',') || s.includes('"') || s.includes('\n'))
        ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(','),
      ...rows.map(r => headers.map(h => esc(r[h])).join(',')),
    ].join('\r\n');

    res.setHeader('Content-Disposition', 'attachment; filename="tabora_boys_2026.csv"');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.send('\uFEFF' + csv);
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Admin: Delete Student ───────────────────────────────────────
app.delete('/api/admin/students/:id', async (req, res) => {
  try {
    await deleteStudent(req.params.id);
    res.json({ success: true, message: `Rekodi ya ID ${req.params.id} imefutwa` });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Admin: PDF Signed Download URL ─────────────────────────────
app.get('/api/admin/students/:id/pdf', async (req, res) => {
  try {
    const row = await getStudentById(req.params.id);
    if (!row)              return res.status(404).json({ success: false, error: 'Hapatikani' });
    if (!row.pdf_filename) return res.status(404).json({ success: false, error: 'Hakuna PDF' });

    const { data, error } = await supabase.storage
      .from(PDF_BUCKET)
      .createSignedUrl(row.pdf_filename, SIGNED_URL_TTL);

    if (error || !data?.signedUrl)
      return res.status(500).json({ success: false, error: error?.message || 'Imeshindikana' });

    res.json({
      success:   true,
      id:        row.id,
      name:      row.full_name,
      signedUrl: data.signedUrl,
      expiresIn: SIGNED_URL_TTL,
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Registration Open / Close ───────────────────────────────────
app.get('/api/registration-status', (req, res) => {
  const form = req.query.form || 'form1';
  if (!regStatus[form]) return res.status(404).json({ error: 'Fomu haijulikani' });
  res.json(regStatus[form]);
});

app.post('/api/registration-status', async (req, res) => {
  const { form, open, message, deadline } = req.body;
  if (!form || !regStatus[form])
    return res.status(400).json({ error: 'form lazima iwe form1 au form5' });

  regStatus[form] = {
    open:     open === true || open === 'true',
    message:  message  || '',
    deadline: deadline || '',
  };

  try {
    await setSetting('reg_status', regStatus);
    console.log(`✅  RegStatus: ${form} → open=${regStatus[form].open}`);
    res.json({ success: true, form, status: regStatus[form] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── PDF Layout Settings ─────────────────────────────────────────
app.get('/api/pdf-layout', (req, res) => {
  res.json(pdfLayouts[req.query.form || 'form1'] || {});
});

app.post('/api/pdf-layout', async (req, res) => {
  const { form, layout } = req.body;
  if (!form || !['form1', 'form5'].includes(form))
    return res.status(400).json({ error: 'form lazima iwe form1 au form5' });

  pdfLayouts[form] = layout || {};
  try {
    await setSetting('pdf_layouts', pdfLayouts);
    console.log(`✅  PDF layout saved: ${form}`);
    res.json({ success: true, form });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Admin Form Text Edits (shudi.html admin panel) ─────────────
app.get('/api/admin/form-edits', async (req, res) => {
  const form = req.query.form || 'form1';
  try {
    const edits = await getSetting(`form_edits_${form}`, {});
    res.json({ success: true, form, edits });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/admin/form-edits', async (req, res) => {
  const { form, edits } = req.body;
  if (!form) return res.status(400).json({ error: 'form inahitajika' });
  try {
    await setSetting(`form_edits_${form}`, edits || {});
    console.log(`✅  Form edits saved: ${form}`);
    res.json({ success: true, form });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ================================================================
//  START SERVER
// ================================================================
app.listen(PORT, () => {
  const line = '═'.repeat(62);
  console.log(`
╔${line}╗
║  Tabora Boys Secondary School — Registration Server          ║
║  Status   : 🟢 ONLINE                                        ║
║  Port     : ${String(PORT).padEnd(49)}║
║  Database : Supabase (online)                                ║
║  Storage  : Supabase Storage                                 ║
║  Email    : ${String(process.env.SMTP_USER || '').padEnd(49)}║
║  Frontend : ${String(FRONTEND_URL).padEnd(49)}║
╚${line}╝`);
});

module.exports = app;
