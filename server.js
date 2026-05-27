const express    = require('express');
const nodemailer = require('nodemailer');
const cors       = require('cors');
const multer     = require('multer');
const path       = require('path');
const fs         = require('fs');
const Database   = require('better-sqlite3');

const app  = express();
const PORT = process.env.PORT || 5000;

// ── Configuration ──────────────────────────────────────────────
const SCHOOL_EMAIL = 'christiankibona840@gmail.com';
const SMTP_CONFIG  = {
  service: 'gmail',
  auth: {
    user: 'christiankibona840@gmail.com',
    pass: 'tenq clue zaog zvgh'
  }
};

// ── SQLite Database ────────────────────────────────────────────
const DB_PATH = path.join(__dirname, 'tabora_boys.db');
const db      = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS students (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    jina1            TEXT,
    jina2            TEXT,
    jina3            TEXT,
    full_name        TEXT NOT NULL,
    admission_no     TEXT,
    tarehe           TEXT,
    mwezi            TEXT,
    mwaka            TEXT,
    wilaya_kuzaliwa  TEXT,
    uraia            TEXT,
    dini             TEXT,
    shule_iliyotoka  TEXT,
    mkoa             TEXT,
    wilaya_makazi    TEXT,
    tarafa           TEXT,
    kata             TEXT,
    kijiji           TEXT,
    nambari_nyumba   TEXT,
    mwenyekiti_jina  TEXT,
    mwenyekiti_simu  TEXT,
    mtendaji_jina    TEXT,
    baba_njina       TEXT,
    baba_simu        TEXT,
    mama_njina       TEXT,
    mama_simu        TEXT,
    mlezi_jina       TEXT,
    mlezi_simu       TEXT,
    ndugu_jina       TEXT,
    ndugu_simu       TEXT,
    mzazi_jina       TEXT,
    uhusiano         TEXT,
    mzazi_simu_kuu   TEXT,
    mzazi_anwani     TEXT,
    mzazi_email      TEXT,
    damu             TEXT,
    bima             TEXT,
    bima_aina        TEXT,
    magonjwa         TEXT,
    cheeti_status    TEXT,
    fomu_d           TEXT,
    registration_date TEXT,
    email_sent        INTEGER NOT NULL DEFAULT 0,
    email_message_id  TEXT,
    pdf_filename      TEXT,
    raw_json          TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_full_name ON students(full_name);
  CREATE INDEX IF NOT EXISTS idx_created   ON students(created_at);
  CREATE INDEX IF NOT EXISTS idx_admission ON students(admission_no);
`);

const insertStudent = db.prepare(`
  INSERT INTO students (
    jina1, jina2, jina3, full_name,
    admission_no, tarehe, mwezi, mwaka,
    wilaya_kuzaliwa, uraia, dini, shule_iliyotoka,
    mkoa, wilaya_makazi, tarafa, kata, kijiji, nambari_nyumba,
    mwenyekiti_jina, mwenyekiti_simu, mtendaji_jina,
    baba_njina, baba_simu, mama_njina, mama_simu,
    mlezi_jina, mlezi_simu, ndugu_jina, ndugu_simu,
    mzazi_jina, uhusiano, mzazi_simu_kuu, mzazi_anwani, mzazi_email,
    damu, bima, bima_aina, magonjwa, cheeti_status, fomu_d,
    registration_date, email_sent, email_message_id, pdf_filename, raw_json
  ) VALUES (
    @jina1, @jina2, @jina3, @full_name,
    @admission_no, @tarehe, @mwezi, @mwaka,
    @wilaya_kuzaliwa, @uraia, @dini, @shule_iliyotoka,
    @mkoa, @wilaya_makazi, @tarafa, @kata, @kijiji, @nambari_nyumba,
    @mwenyekiti_jina, @mwenyekiti_simu, @mtendaji_jina,
    @baba_njina, @baba_simu, @mama_njina, @mama_simu,
    @mlezi_jina, @mlezi_simu, @ndugu_jina, @ndugu_simu,
    @mzazi_jina, @uhusiano, @mzazi_simu_kuu, @mzazi_anwani, @mzazi_email,
    @damu, @bima, @bima_aina, @magonjwa, @cheeti_status, @fomu_d,
    @registration_date, 0, NULL, @pdf_filename, @raw_json
  )
`);

const updateEmailStatus = db.prepare(
  `UPDATE students SET email_sent = 1, email_message_id = ? WHERE id = ?`
);

console.log('✅ SQLite database ready:', DB_PATH);

// ── Middleware ─────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname)));

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename:    (req, file, cb) => cb(null, 'reg-' + Date.now() + '.pdf')
});
const upload = multer({ storage });

// ── Email ──────────────────────────────────────────────────────
const transporter = nodemailer.createTransport(SMTP_CONFIG);
transporter.verify((err) => {
  if (err) console.error('❌ Email error:', err.message);
  else     console.log('✅ Email server ready');
});

function buildEmailHTML(d, fullName, submissionDate) {
  const dob = [d.tarehe, d.mwezi, d.mwaka].filter(Boolean).join('/');
  const row = (l, v) => `<tr>
    <td style="padding:8px 14px;font-weight:600;color:#555;background:#f7f9fc;width:38%;border-bottom:1px solid #eef2f7;">${l}</td>
    <td style="padding:8px 14px;color:#1a1a2e;border-bottom:1px solid #eef2f7;">${v||'—'}</td></tr>`;
  const sec = (icon, title, rows) => `<div style="margin-bottom:20px;">
    <div style="background:#1a365d;color:white;padding:8px 14px;font-size:13px;font-weight:700;border-radius:6px 6px 0 0;">${icon} ${title}</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #dde3ed;border-top:none;">${rows}</table></div>`;
  return `<!DOCTYPE html><html lang="sw"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:'Segoe UI',Arial,sans-serif;">
<div style="max-width:650px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.1);">
<div style="background:linear-gradient(135deg,#0d1f3c,#1a365d);padding:28px 32px;">
  <div style="color:white;font-size:17px;font-weight:800;">🏫 SHULE YA SEKONDARI TABORA WAVULANA</div>
  <div style="color:#f0c84a;font-size:11px;margin-top:3px;font-weight:600;">Usajili Mpya — Kidato cha Kwanza 2026</div>
</div>
<div style="height:4px;background:linear-gradient(90deg,#c8962a,#f0c84a,#c8962a);"></div>
<div style="padding:16px 28px;background:#e8f5e9;border-left:4px solid #2d6a4f;">
  <div style="font-weight:700;color:#1b5e20;">✅ Mwanafunzi Mpya — ${submissionDate}</div>
</div>
<div style="padding:24px 28px;">
  ${sec('👤','TAARIFA ZA KIBINAFSI',
    row('Jina Kamili',`<strong style="color:#1a365d;">${fullName}</strong>`)+
    row('Tarehe ya Kuzaliwa',dob)+row('Wilaya ya Kuzaliwa',d.wilayaKuzaliwa)+
    row('Uraia',d.uraia)+row('Dini',d.dini)+row('Shule Iliyotoka',d.shuleIliyotoka)+
    row('Namba Usajili',`<strong style="color:#2b5fa5;">${d.admissionNo||'—'}</strong>`)+
    row('Mkoa/Wilaya',[d.mkoa,d.wilayaMakazi].filter(Boolean).join(' / '))+
    row('Kata/Kijiji',[d.kata,d.kijiji].filter(Boolean).join(' / ')))}
  ${sec('👨‍👩‍👦','FAMILIA',
    row('Baba',d.babaNjina)+row('Simu ya Baba',d.babaSimu)+
    row('Mama',d.mamaNjina)+row('Simu ya Mama',d.mamaSimu)+
    row('Mlezi',[d.mleziJina,d.mleziSimu].filter(Boolean).join(' — '))+
    row('Ndugu',[d.nduguJina,d.nduguSimu].filter(Boolean).join(' — ')))}
  ${sec('🤝','MZAZI/MLEZI MKUU',
    row('Jina',`<strong>${d.mzaziJina}</strong>`)+row('Uhusiano',d.uhusiano)+
    row('Simu Kuu',`<strong style="color:#2b5fa5;">${d.mzaziSimuKuu}</strong>`)+
    row('Barua Pepe',d.mzaziEmail||'Haitolewa')+row('Anwani',d.mzaziAnwani))}
  ${sec('🏥','AFYA',
    row('Kundi la Damu',`<strong style="color:#c0392b;">${d.damu}</strong>`)+
    row('Bima',d.bima)+row('Aina ya Bima',d.bimaAina)+row('Magonjwa',d.magonjwa||'Hakuna'))}
</div>
<div style="background:#f7f9fc;padding:16px 28px;text-align:center;font-size:11px;color:#888;">
  <strong style="color:#1a365d;">Shule ya Sekondari Tabora Wavulana</strong><br>
  S.L.P 374, Tabora · Simu: 0755 297 005 · <span style="color:#c8962a;">christiankibona840@gmail.com</span>
</div></div></body></html>`;
}

// ── Routes ─────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const { total } = db.prepare('SELECT COUNT(*) AS total FROM students').get();
  res.json({ status: 'ok', total_registrations: total });
});

app.post('/api/test-email', async (req, res) => {
  try {
    const info = await transporter.sendMail({
      from: `"Tabora Boys System" <${SMTP_CONFIG.auth.user}>`,
      to: SCHOOL_EMAIL, subject: 'Test Email', html: '<p>Mfumo unafanya kazi!</p>'
    });
    res.json({ success: true, messageId: info.messageId });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/register', upload.single('pdf'), async (req, res) => {
  const pdfPath = req.file ? req.file.path : null;
  let studentId = null;
  try {
    const d = JSON.parse(req.body.studentData);
    const fullName = [d.jina1, d.jina2, d.jina3].filter(Boolean).join(' ') || 'Haijajazwa';
    const submissionDate = new Date().toLocaleString('en-GB', { timeZone: 'Africa/Dar_es_Salaam' });

    console.log('📥 Fields received:', Object.keys(d).join(', '));
    console.log('👤 Name:', fullName);

    const result = insertStudent.run({
      jina1: d.jina1||null, jina2: d.jina2||null, jina3: d.jina3||null,
      full_name: fullName,
      admission_no: d.admissionNo||null,
      tarehe: d.tarehe||null, mwezi: d.mwezi||null, mwaka: d.mwaka||null,
      wilaya_kuzaliwa: d.wilayaKuzaliwa||null,
      uraia: d.uraia||null, dini: d.dini||null,
      shule_iliyotoka: d.shuleIliyotoka||null,
      mkoa: d.mkoa||null, wilaya_makazi: d.wilayaMakazi||null,
      tarafa: d.tarafa||null, kata: d.kata||null,
      kijiji: d.kijiji||null, nambari_nyumba: d.nambariNyumba||null,
      mwenyekiti_jina: d.mwenyekitiJina||null, mwenyekiti_simu: d.mwenyekitiSimu||null,
      mtendaji_jina: d.mtendajiJina||null,
      baba_njina: d.babaNjina||null, baba_simu: d.babaSimu||null,
      mama_njina: d.mamaNjina||null, mama_simu: d.mamaSimu||null,
      mlezi_jina: d.mleziJina||null, mlezi_simu: d.mleziSimu||null,
      ndugu_jina: d.nduguJina||null, ndugu_simu: d.nduguSimu||null,
      mzazi_jina: d.mzaziJina||null, uhusiano: d.uhusiano||null,
      mzazi_simu_kuu: d.mzaziSimuKuu||null,
      mzazi_anwani: d.mzaziAnwani||null, mzazi_email: d.mzaziEmail||null,
      damu: d.damu||null, bima: d.bima||null, bima_aina: d.bimaAina||null,
      magonjwa: d.magonjwa||null, cheeti_status: d.cheetiStatus||null,
      fomu_d: d.fomuD||null,
      registration_date: submissionDate,
      pdf_filename: req.file ? path.basename(req.file.path) : null,
      raw_json: JSON.stringify(d)
    });

    studentId = result.lastInsertRowid;
    console.log(`💾 Saved — DB ID: ${studentId}`);

    const attachments = [];
    if (pdfPath && fs.existsSync(pdfPath)) {
      attachments.push({ filename: `TaboraBoys_${fullName.replace(/\s+/g,'_')}_2026.pdf`, path: pdfPath });
    }

    const info = await transporter.sendMail({
      from: `"Tabora Boys Registration" <${SMTP_CONFIG.auth.user}>`,
      to: SCHOOL_EMAIL,
      subject: `🎓 Usajili Mpya: ${fullName} | ${submissionDate}`,
      html: buildEmailHTML(d, fullName, submissionDate),
      attachments
    });

    updateEmailStatus.run(info.messageId, studentId);
    if (pdfPath) setTimeout(() => fs.unlink(pdfPath, ()=>{}), 10_000);

    console.log(`✅ Done — ID ${studentId} — email ${info.messageId}`);
    res.json({ success: true, message: 'Usajili umefanikiwa!', studentId, emailSent: true });

  } catch(err) {
    console.error('Registration error:', err);
    res.status(500).json({ success: false, error: err.message, studentId });
  }
});

// ── Admin endpoints ────────────────────────────────────────────
app.get('/api/admin/students', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page||'1',10));
  const limit = Math.min(100, parseInt(req.query.limit||'20',10));
  const rows = db.prepare(`SELECT id,created_at,full_name,admission_no,shule_iliyotoka,mzazi_simu_kuu,damu,email_sent,registration_date FROM students ORDER BY id DESC LIMIT ? OFFSET ?`).all(limit,(page-1)*limit);
  const {total} = db.prepare('SELECT COUNT(*) AS total FROM students').get();
  res.json({ success:true, page, limit, total, pages:Math.ceil(total/limit), data:rows });
});

app.get('/api/admin/students/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ success:false, error:'Hapatikani' });
  res.json({ success:true, data:row });
});

app.get('/api/admin/search', (req, res) => {
  const q = `%${(req.query.q||'').trim()}%`;
  const rows = db.prepare(`SELECT id,created_at,full_name,admission_no,shule_iliyotoka,mzazi_simu_kuu,email_sent FROM students WHERE full_name LIKE ? OR admission_no LIKE ? OR shule_iliyotoka LIKE ? OR baba_njina LIKE ? OR mama_njina LIKE ? ORDER BY id DESC LIMIT 50`).all(q,q,q,q,q);
  res.json({ success:true, count:rows.length, data:rows });
});

app.get('/api/admin/stats', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) AS n FROM students').get().n;
  const emailSent = db.prepare('SELECT COUNT(*) AS n FROM students WHERE email_sent=1').get().n;
  const byBlood = db.prepare(`SELECT damu AS label,COUNT(*) AS n FROM students WHERE damu IS NOT NULL GROUP BY damu ORDER BY n DESC`).all();
  const byReligion = db.prepare(`SELECT dini AS label,COUNT(*) AS n FROM students WHERE dini IS NOT NULL GROUP BY dini ORDER BY n DESC`).all();
  const bySchool = db.prepare(`SELECT shule_iliyotoka AS label,COUNT(*) AS n FROM students WHERE shule_iliyotoka IS NOT NULL GROUP BY shule_iliyotoka ORDER BY n DESC LIMIT 10`).all();
  const perDay = db.prepare(`SELECT date(created_at) AS day,COUNT(*) AS n FROM students GROUP BY day ORDER BY day DESC LIMIT 14`).all();
  res.json({ success:true, total, emailSent, emailPending:total-emailSent, byBlood, byReligion, bySchool, perDay });
});

app.get('/api/admin/export/json', (req, res) => {
  const rows = db.prepare('SELECT * FROM students ORDER BY id').all();
  res.setHeader('Content-Disposition','attachment; filename="tabora_boys_2026.json"');
  res.setHeader('Content-Type','application/json');
  res.send(JSON.stringify(rows,null,2));
});

app.get('/api/admin/export/csv', (req, res) => {
  const rows = db.prepare('SELECT * FROM students ORDER BY id').all();
  if (!rows.length) return res.send('Hakuna data');
  const esc = v => { if(v==null)return''; const s=String(v); return (s.includes(',')||s.includes('"')||s.includes('\n'))?`"${s.replace(/"/g,'""')}"`:s; };
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(','),...rows.map(r=>headers.map(h=>esc(r[h])).join(','))].join('\r\n');
  res.setHeader('Content-Disposition','attachment; filename="tabora_boys_2026.csv"');
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.send('\uFEFF'+csv);
});

app.delete('/api/admin/students/:id', (req, res) => {
  const info = db.prepare('DELETE FROM students WHERE id=?').run(req.params.id);
  if (info.changes===0) return res.status(404).json({ success:false, error:'Hapatikani' });
  res.json({ success:true, message:`Rekodi ya ID ${req.params.id} imefutwa` });
});

// ── SQLite: add form5 columns if they don't exist ──────────────
try {
  db.exec(`
    ALTER TABLE students ADD COLUMN form_level     TEXT DEFAULT 'form1';
    ALTER TABLE students ADD COLUMN combination    TEXT;
    ALTER TABLE students ADD COLUMN index_no_olevel TEXT;
    ALTER TABLE students ADD COLUMN csee_year      TEXT;
    ALTER TABLE students ADD COLUMN csee_division  TEXT;
    ALTER TABLE students ADD COLUMN csee_points    TEXT;
    ALTER TABLE students ADD COLUMN csee_aggregates TEXT;
    ALTER TABLE students ADD COLUMN csee_index_no  TEXT;
    ALTER TABLE students ADD COLUMN results_json   TEXT;
    ALTER TABLE students ADD COLUMN jinsia         TEXT;
  `);
} catch(e) { /* columns already exist — safe to ignore */ }

// ── Registration Status (persisted to file) ────────────────────
const REG_STATUS_FILE = path.join(__dirname, 'reg_status.json');

let regStatus = {
  form1: { open: true, message: 'Usajili wa Kidato cha Kwanza umefungwa.', deadline: '' },
  form5: { open: true, message: 'Usajili wa Kidato cha 5 umefungwa.', deadline: '' },
};

try {
  if (fs.existsSync(REG_STATUS_FILE)) {
    Object.assign(regStatus, JSON.parse(fs.readFileSync(REG_STATUS_FILE, 'utf8')));
    console.log('✅ Registration status loaded');
  }
} catch(e) { console.error('RegStatus load error:', e.message); }

function saveRegStatus() {
  try { fs.writeFileSync(REG_STATUS_FILE, JSON.stringify(regStatus, null, 2)); }
  catch(e) { console.error('RegStatus save error:', e.message); }
}

// ── PDF Layout Settings (persisted to file) ───────────────────
const PDF_LAYOUTS_FILE = path.join(__dirname, 'pdf_layouts.json');
let pdfLayouts = { form1: {}, form5: {} };

try {
  if (fs.existsSync(PDF_LAYOUTS_FILE)) {
    pdfLayouts = JSON.parse(fs.readFileSync(PDF_LAYOUTS_FILE, 'utf8'));
    console.log('✅ PDF layouts loaded');
  }
} catch(e) { console.error('PdfLayouts load error:', e.message); }

function savePdfLayouts() {
  try { fs.writeFileSync(PDF_LAYOUTS_FILE, JSON.stringify(pdfLayouts, null, 2)); }
  catch(e) { console.error('PdfLayouts save error:', e.message); }
}

app.get('/api/status', (req, res) => {
  const { total } = db.prepare('SELECT COUNT(*) AS total FROM students').get();
  res.json({ status: 'ok', total_registrations: total, regStatus });
});

app.get('/api/registration-status', (req, res) => {
  const form = req.query.form || 'form1';
  if (!regStatus[form]) return res.status(404).json({ error: 'Fomu haijulikani' });
  res.json(regStatus[form]);
});

app.post('/api/registration-status', (req, res) => {
  const { form, open, message, deadline } = req.body;
  if (!form || !regStatus[form]) return res.status(400).json({ error: 'form lazima iwe form1 au form5' });
  regStatus[form] = { open: open === true || open === 'true', message: message || '', deadline: deadline || '' };
  saveRegStatus();
  console.log(`RegStatus: ${form} => open:${regStatus[form].open}`);
  res.json({ success: true, form, status: regStatus[form] });
});

app.get('/api/pdf-layout', (req, res) => {
  const form = req.query.form || 'form1';
  res.json(pdfLayouts[form] || {});
});

app.post('/api/pdf-layout', (req, res) => {
  const { form, layout } = req.body;
  if (!form || !['form1','form5'].includes(form)) return res.status(400).json({ error: 'form lazima iwe form1 au form5' });
  pdfLayouts[form] = layout || {};
  savePdfLayouts();
  console.log(`PdfLayouts: saved for ${form}`);
  res.json({ success: true, form });
});

// ── Override /api/register to support both form1 and form5 ─────
app._router.stack = app._router.stack.filter(layer => {
  if (layer.route && layer.route.path === '/api/register') return false;
  return true;
});

app.post('/api/register', upload.single('pdf'), async (req, res) => {
  const pdfPath = req.file ? req.file.path : null;
  let studentId = null;
  try {
    const d = JSON.parse(req.body.studentData);
    const formLevel = d.formLevel || 'form1';

    if (!regStatus[formLevel]?.open) {
      return res.status(403).json({
        success: false,
        error: 'Usajili umefungwa',
        message: regStatus[formLevel]?.message || 'Usajili umefungwa kwa sasa.'
      });
    }

    const fullName = [d.jina1, d.jina2, d.jina3].filter(Boolean).join(' ') || 'Haijajazwa';
    const submissionDate = new Date().toLocaleString('en-GB', { timeZone: 'Africa/Dar_es_Salaam' });
    const comboLabel = d.combination ? ` — Mkondo: ${d.combination}` : '';
    const formLabel  = formLevel === 'form5' ? 'Kidato cha 5' : 'Kidato cha Kwanza';

    console.log(`📥 ${formLabel}${comboLabel} | ${fullName}`);

    const result = insertStudent.run({
      jina1: d.jina1||null, jina2: d.jina2||null, jina3: d.jina3||null,
      full_name: fullName,
      admission_no: d.admissionNo||null,
      tarehe: d.tarehe||null, mwezi: d.mwezi||d.tarehe||null, mwaka: d.mwaka||null,
      wilaya_kuzaliwa: d.wilayaKuzaliwa||null,
      uraia: d.uraia||null, dini: d.dini||null,
      shule_iliyotoka: d.shuleIliyotoka||null,
      mkoa: d.mkoa||null, wilaya_makazi: d.wilayaMakazi||null,
      tarafa: d.tarafa||null, kata: d.kata||null,
      kijiji: d.kijiji||null, nambari_nyumba: d.nambariNyumba||null,
      mwenyekiti_jina: d.mwenyekitiJina||null, mwenyekiti_simu: d.mwenyekitiSimu||null,
      mtendaji_jina: d.mtendajiJina||null,
      baba_njina: d.babaNjina||null, baba_simu: d.babaSimu||null,
      mama_njina: d.mamaNjina||null, mama_simu: d.mamaSimu||null,
      mlezi_jina: d.mleziJina||null, mlezi_simu: d.mleziSimu||null,
      ndugu_jina: d.nduguJina||null, ndugu_simu: d.nduguSimu||null,
      mzazi_jina: d.mzaziJina||null, uhusiano: d.uhusiano||null,
      mzazi_simu_kuu: d.mzaziSimuKuu||d.babaSimu||null,
      mzazi_anwani: d.mzaziAnwani||null, mzazi_email: d.mzaziEmail||null,
      damu: d.damu||null, bima: d.bima||null, bima_aina: d.bimaAina||null,
      magonjwa: d.magonjwa||null, cheeti_status: d.cheetiStatus||null,
      fomu_d: d.fomuD||null,
      registration_date: submissionDate,
      pdf_filename: req.file ? path.basename(req.file.path) : null,
      raw_json: JSON.stringify(d)
    });

    if (formLevel === 'form5') {
      try {
        db.prepare(`UPDATE students SET
          form_level=?, combination=?, index_no_olevel=?,
          csee_year=?, csee_division=?, csee_points=?, csee_aggregates=?,
          csee_index_no=?, results_json=?, jinsia=?
          WHERE id=?`).run(
          formLevel, d.combination||null, d.indexNoOlevel||null,
          d.cseeYear||null, d.cseeDivision||null, d.cseePoints||null, d.cseeAggregates||null,
          d.cseeIndexNo||null, d.results ? JSON.stringify(d.results) : null, d.jinsia||null,
          result.lastInsertRowid
        );
      } catch(e) { console.warn('Form5 extra fields save failed:', e.message); }
    } else {
      try {
        db.prepare('UPDATE students SET form_level=? WHERE id=?').run('form1', result.lastInsertRowid);
      } catch(e) {}
    }

    studentId = result.lastInsertRowid;
    console.log(`💾 Saved — DB ID: ${studentId}`);

    const attachments = [];
    if (pdfPath && fs.existsSync(pdfPath)) {
      attachments.push({ filename: `TaboraBoys_${formLabel.replace(/\s+/g,'_')}_${fullName.replace(/\s+/g,'_')}_2026.pdf`, path: pdfPath });
    }

    let emailHtml;
    if (formLevel === 'form5') {
      emailHtml = buildForm5EmailHTML(d, fullName, submissionDate);
    } else {
      emailHtml = buildEmailHTML(d, fullName, submissionDate);
    }

    const info = await transporter.sendMail({
      from: `"Tabora Boys Registration" <${SMTP_CONFIG.auth.user}>`,
      to: SCHOOL_EMAIL,
      subject: `🎓 Usajili Mpya: ${fullName} | ${formLabel}${comboLabel} | ${submissionDate}`,
      html: emailHtml,
      attachments
    });

    updateEmailStatus.run(info.messageId, studentId);
    if (pdfPath) setTimeout(() => fs.unlink(pdfPath, ()=>{}), 10_000);

    console.log(`✅ Done — ID ${studentId} — email ${info.messageId}`);
    res.json({ success: true, message: 'Usajili umefanikiwa!', studentId, emailSent: true });

  } catch(err) {
    console.error('Registration error:', err);
    res.status(500).json({ success: false, error: err.message, studentId });
  }
});

// ── Form 5 email HTML builder ──────────────────────────────────
function buildForm5EmailHTML(d, fullName, submissionDate) {
  const row = (l, v) => `<tr>
    <td style="padding:8px 14px;font-weight:600;color:#555;background:#f7f9fc;width:38%;border-bottom:1px solid #eef2f7;">${l}</td>
    <td style="padding:8px 14px;color:#1a1a2e;border-bottom:1px solid #eef2f7;">${v||'—'}</td></tr>`;
  const sec = (icon, title, rows) => `<div style="margin-bottom:20px;">
    <div style="background:#553c9a;color:white;padding:8px 14px;font-size:13px;font-weight:700;border-radius:6px 6px 0 0;">${icon} ${title}</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #dde3ed;border-top:none;">${rows}</table></div>`;

  const combos = { PCB:'Physics, Chemistry & Biology', PAM:'Physics, Adv. Maths & Further Maths', HGL:'History, Geography & Literature', PMC:'Physics, Mathematics & Chemistry' };
  const comboName = combos[d.combination] || d.combination || '—';

  let resultsRows = '';
  if (d.results && d.results.length) {
    resultsRows = d.results.map(r => row(r.subject, `${r.grade} (${r.points} pts)`)).join('');
  }

  return `<!DOCTYPE html><html lang="sw"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:'Segoe UI',Arial,sans-serif;">
<div style="max-width:650px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.1);">
<div style="background:linear-gradient(135deg,#2d1b69,#553c9a);padding:28px 32px;">
  <div style="color:white;font-size:17px;font-weight:800;">🏫 SHULE YA SEKONDARI TABORA WAVULANA</div>
  <div style="color:#e9d8fd;font-size:11px;margin-top:3px;font-weight:600;">Usajili Mpya — Kidato cha 5 2026</div>
</div>
<div style="height:4px;background:linear-gradient(90deg,#553c9a,#e9d8fd,#553c9a);"></div>
<div style="padding:16px 28px;background:#faf5ff;border-left:4px solid #553c9a;">
  <div style="font-weight:700;color:#2d1b69;">✅ Mwanafunzi Mpya — ${submissionDate}</div>
</div>
<div style="padding:24px 28px;">
  <div style="background:#e9d8fd;border-radius:8px;padding:12px 16px;margin-bottom:20px;display:inline-block;">
    <strong style="color:#2d1b69;font-size:16px;">Mkondo: ${d.combination||'—'}</strong>
    <span style="color:#553c9a;font-size:12px;margin-left:8px;">${comboName}</span>
  </div>
  ${sec('👤','TAARIFA ZA KIBINAFSI',
    row('Jina Kamili',`<strong style="color:#1a365d;">${fullName}</strong>`)+
    row('Tarehe ya Kuzaliwa',d.tarehe||'—')+row('Uraia',d.uraia)+row('Dini',d.dini)+
    row('Shule ya O-Level',d.shuleIliyotoka)+row('Index No',d.indexNoOlevel||'—')+
    row('Namba Usajili',d.admissionNo||'—'))}
  ${sec('📊','MATOKEO YA CSEE',
    row('Mwaka',d.cseeYear||'—')+row('Daraja',d.cseeDivision ? 'Division '+d.cseeDivision : '—')+
    row('Aggregate',d.cseeAggregates||'—')+
    (resultsRows ? resultsRows : row('Matokeo','Hayakuingizwa')))}
  ${sec('🏠','MAKAZI',
    row('Mkoa/Wilaya',[d.mkoa,d.wilayaMakazi].filter(Boolean).join(' / '))+
    row('Kata/Kijiji',[d.kata,d.kijiji].filter(Boolean).join(' / ')))}
  ${sec('👨‍👩‍👦','FAMILIA',
    row('Baba',d.babaNjina)+row('Simu ya Baba',d.babaSimu)+
    row('Mama',d.mamaNjina)+row('Simu ya Mama',d.mamaSimu)+
    row('Mlezi',[d.mleziJina,d.mleziSimu].filter(Boolean).join(' — ')))}
</div>
<div style="background:#f7f9fc;padding:16px 28px;text-align:center;font-size:11px;color:#888;">
  <strong style="color:#553c9a;">Shule ya Sekondari Tabora Wavulana</strong><br>
  S.L.P 374, Tabora · Simu: 0755 297 005
</div></div></body></html>`;
}

// ── Admin: get students with form/combo filter ─────────────────
app.get('/api/admin/students/filter', (req, res) => {
  const { form, combo } = req.query;
  const page  = Math.max(1, parseInt(req.query.page||'1', 10));
  const limit = Math.min(100, parseInt(req.query.limit||'20', 10));

  let where = 'WHERE 1=1';
  const params = [];
  if (form)  { where += ' AND form_level=?';  params.push(form); }
  if (combo) { where += ' AND combination=?'; params.push(combo); }

  const rows  = db.prepare(`SELECT id,created_at,full_name,admission_no,form_level,combination,shule_iliyotoka,mzazi_simu_kuu,email_sent,registration_date FROM students ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, limit, (page-1)*limit);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM students ${where}`).get(...params).n;
  res.json({ success:true, page, limit, total, pages:Math.ceil(total/limit), data:rows });
});

// ── Admin: combined summary ────────────────────────────────────
app.get('/api/admin/summary', (req, res) => {
  const total   = db.prepare('SELECT COUNT(*) AS n FROM students').get().n;
  const form1   = db.prepare("SELECT COUNT(*) AS n FROM students WHERE form_level='form1' OR form_level IS NULL").get().n;
  const form5   = db.prepare("SELECT COUNT(*) AS n FROM students WHERE form_level='form5'").get().n;
  const combos  = ['PCB','PAM','HGL','PMC'].reduce((acc, c) => {
    acc[c] = db.prepare("SELECT COUNT(*) AS n FROM students WHERE combination=?").get(c).n;
    return acc;
  }, {});
  res.json({ success:true, total, form1, form5, combinations: combos, regStatus });
});

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  Tabora Boys Secondary School — Registration Server          ║
║  http://localhost:${PORT}                                       ║
║  Database : tabora_boys.db (SQLite3)                         ║
║  Admin    : http://localhost:${PORT}/admin.html                 ║
╚══════════════════════════════════════════════════════════════╝`);
});

module.exports = app;
