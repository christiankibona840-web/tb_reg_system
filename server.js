const express          = require('express');
const nodemailer       = require('nodemailer');
const cors             = require('cors');
const multer           = require('multer');
const path             = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

app.get('/', (req, res) => {
  // Change 'index.html' below if your main file has a different name
  res.sendFile(path.join(__dirname, 'index_enhanced.html')); 
});

const app  = express();
const PORT = process.env.PORT || 5000;

// Defaults for this project (override via env vars in production)
const SUPABASE_URL  = process.env.SUPABASE_URL  || 'https://mfkvwcryiclehbrkqthu.supabase.co';
const SUPABASE_KEY  =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY;
if (!SUPABASE_KEY) {
  throw new Error('Missing SUPABASE key: set SUPABASE_SERVICE_ROLE_KEY (recommended) or SUPABASE_ANON_KEY');
}
const SCHOOL_EMAIL  = process.env.SCHOOL_EMAIL  || 'christiankibona840@gmail.com';
const SMTP_USER     = process.env.SMTP_USER     || '';
const SMTP_PASS     = process.env.SMTP_PASS     || '';
const FRONTEND_URL  = process.env.FRONTEND_URL  || '';
const PDF_BUCKET    = process.env.SUPABASE_PDF_BUCKET || 'registrations';
const PDF_PREFIX    = process.env.SUPABASE_PDF_PREFIX || 'registrations';
const SIGNED_TTL    = Math.max(60, parseInt(process.env.SUPABASE_SIGNED_URL_TTL || '3600', 10));

// Email is optional; storage+DB should still work without SMTP.
const EMAIL_ENABLED = Boolean(SMTP_USER && SMTP_PASS);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
console.log('Supabase connected:', SUPABASE_URL);

// CORS — allow Vercel, Railway and localhost
const ALLOWED = [
  'http://localhost:5500','http://127.0.0.1:5500',
  'http://localhost:3000','http://127.0.0.1:3000',
  'http://localhost:5000',
];
if (FRONTEND_URL) ALLOWED.push(FRONTEND_URL);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (origin.endsWith('.vercel.app'))  return cb(null, true);
    if (origin.endsWith('.railway.app')) return cb(null, true);
    if (ALLOWED.includes(origin))        return cb(null, true);
    cb(new Error('CORS blocked: ' + origin));
  },
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname)));
const upload = multer({ storage: multer.memoryStorage() });

function normalizeNida(nida) {
  return String(nida || '').replace(/\s+/g, '').toUpperCase();
}

const transporter = EMAIL_ENABLED
  ? nodemailer.createTransport({
      service: process.env.SMTP_SERVICE || 'gmail',
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    })
  : null;

if (transporter) {
  transporter.verify(err => err
    ? console.error('Email error:', err.message)
    : console.log('Email ready'));
} else {
  console.log('Email disabled: SMTP_USER/SMTP_PASS not set');
}

// ── Supabase DB helpers ──────────────────────────────────────
async function dbInsert(row) {
  const { data, error } = await supabase.from('students').insert(row).select('id').single();
  if (error) throw new Error(error.message);
  return data.id;
}
async function dbUpdate(id, patch) {
  const { error } = await supabase.from('students').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}
async function dbGetById(id) {
  const { data, error } = await supabase.from('students').select('*').eq('id', id).single();
  return error ? null : data;
}
async function dbDelete(id) {
  const { error } = await supabase.from('students').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
async function dbCount() {
  const { count, error } = await supabase.from('students').select('id', { count: 'exact', head: true });
  if (error) throw new Error(error.message);
  return count || 0;
}
async function dbPage(page, limit) {
  const { data, count, error } = await supabase
    .from('students')
    .select('id,created_at,full_name,admission_no,form_level,combination,shule_iliyotoka,mzazi_simu_kuu,damu,email_sent,registration_date', { count: 'exact' })
    .order('id', { ascending: false })
    .range((page-1)*limit, page*limit-1);
  if (error) throw new Error(error.message);
  return { rows: data||[], total: count||0 };
}

// ── Settings in Supabase (replaces local JSON files) ─────────
async function getSetting(key, fallback = null) {
  const { data } = await supabase.from('settings').select('value').eq('key', key).maybeSingle();
  return data ? data.value : fallback;
}
async function setSetting(key, value) {
  const { error } = await supabase.from('settings')
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
  // Keep as JSON string to avoid Supabase column type assumptions.
  await setSetting(key, JSON.stringify(value ?? null));
}

const DEFAULT_REG = {
  form1: { open: true, message: 'Usajili wa Kidato cha Kwanza umefungwa.', deadline: '' },
  form5: { open: true, message: 'Usajili wa Kidato cha 5 umefungwa.', deadline: '' }
};
let regStatus  = { ...DEFAULT_REG };
let pdfLayouts = { form1: {}, form5: {} };

const SETTINGS_KEYS = {
  regStatus: 'reg_status',
  pdfLayouts: 'pdf_layouts',
  nidaStore: 'nida_store',
  formEditsForm1: 'form_edits_form1',
  formEditsForm5: 'form_edits_form5',
};

// Load settings on startup
(async () => {
  try {
    const rs = await getJsonSetting(SETTINGS_KEYS.regStatus, DEFAULT_REG);
    const pl = await getJsonSetting(SETTINGS_KEYS.pdfLayouts, { form1:{}, form5:{} });
    Object.assign(regStatus, rs || {});
    Object.assign(pdfLayouts, pl || {});
    console.log('Settings loaded from Supabase');
  } catch(e) { console.warn('Settings load failed:', e.message); }
})();

// ── Supabase PDF upload ───────────────────────────────────────
async function uploadPdf({ buffer, contentType, fileName, studentId }) {
  const safe = String(fileName||`reg-${Date.now()}.pdf`).replace(/[^\w.\-]+/g,'_');
  const p    = `${PDF_PREFIX}/${studentId||'x'}/${Date.now()}-${safe}`;
  const { data, error } = await supabase.storage.from(PDF_BUCKET)
    .upload(p, buffer, { contentType: contentType||'application/pdf', upsert: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, bucket: PDF_BUCKET, path: data.path };
}

// ── Email builders ────────────────────────────────────────────
function row(l,v){ return `<tr><td style="padding:8px 14px;font-weight:600;color:#555;background:#f7f9fc;width:38%;border-bottom:1px solid #eef2f7;">${l}</td><td style="padding:8px 14px;color:#222;border-bottom:1px solid #eef2f7;">${v||'—'}</td></tr>`; }
function sec(bg,icon,title,rows){ return `<div style="margin-bottom:20px;"><div style="background:${bg};color:white;padding:8px 14px;font-size:13px;font-weight:700;border-radius:6px 6px 0 0;">${icon} ${title}</div><table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #dde3ed;border-top:none;">${rows}</table></div>`; }

function buildEmail(d, fullName, date, isForm5) {
  const bg = isForm5 ? '#553c9a' : '#1a365d';
  const lbl= isForm5 ? 'Kidato cha 5 2026' : 'Kidato cha Kwanza 2026';
  const combos = {PCB:'Physics, Chemistry & Biology',PAM:'Physics, Adv. Maths & Further Maths',HGL:'History, Geography & Literature',PMC:'Physics, Mathematics & Chemistry'};
  const extra = isForm5 ? `<div style="background:#e9d8fd;border-radius:8px;padding:10px 14px;margin-bottom:18px;"><strong style="color:#2d1b69;">Mkondo: ${d.combination||'—'}</strong> <span style="color:#553c9a;font-size:12px;">${combos[d.combination]||''}</span></div>` : '';
  const cseeRows = isForm5 ? sec(bg,'📊','MATOKEO YA CSEE', row('Mwaka',d.cseeYear)+row('Daraja',d.cseeDivision?'Division '+d.cseeDivision:'—')+row('Aggregate',d.cseeAggregates||'—')+((d.results||[]).map(r=>row(r.subject,`${r.grade} (${r.points} pts)`)).join('')||row('Matokeo','Hayakuingizwa'))) : '';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f0f4f8;font-family:'Segoe UI',Arial,sans-serif;"><div style="max-width:650px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1);"><div style="background:linear-gradient(135deg,${isForm5?'#2d1b69':' #0d1f3c'},${bg});padding:28px 32px;"><div style="color:white;font-size:17px;font-weight:800;">🏫 SHULE YA SEKONDARI TABORA WAVULANA</div><div style="color:${isForm5?'#e9d8fd':'#f0c84a'};font-size:11px;margin-top:3px;">Usajili Mpya — ${lbl}</div></div><div style="padding:16px 28px;background:${isForm5?'#faf5ff':'#e8f5e9'};border-left:4px solid ${isForm5?'#553c9a':'#2d6a4f'};"><strong>✅ Mwanafunzi Mpya — ${date}</strong></div><div style="padding:24px 28px;">${extra}${sec(bg,'👤','TAARIFA ZA KIBINAFSI',row('Jina Kamili',`<strong>${fullName}</strong>`)+row('Shule Iliyotoka',d.shuleIliyotoka)+row('Uraia',d.uraia)+row('Dini',d.dini)+row('Namba Usajili',d.admissionNo||'—')+row('Mkoa/Wilaya',[d.mkoa,d.wilayaMakazi].filter(Boolean).join(' / ')))}${cseeRows}${sec(bg,'👨‍👩‍👦','FAMILIA',row('Baba',d.babaNjina)+row('Simu ya Baba',d.babaSimu)+row('Mama',d.mamaNjina)+row('Simu ya Mama',d.mamaSimu)+row('Mzazi Mkuu',`${d.mzaziJina||'—'} (${d.uhusiano||'—'})`)+row('Simu Kuu',d.mzaziSimuKuu||d.babaSimu||'—'))}${sec(bg,'🏥','AFYA',row('Kundi la Damu',`<strong>${d.damu||'—'}</strong>`)+row('Bima',d.bima)+row('Magonjwa',d.magonjwa||'Hakuna'))}</div><div style="background:#f7f9fc;padding:16px 28px;text-align:center;font-size:11px;color:#888;"><strong>Shule ya Sekondari Tabora Wavulana</strong> · S.L.P 374, Tabora</div></div></body></html>`;
}

// ── ROUTES ────────────────────────────────────────────────────
app.get('/api/status', async (req, res) => {
  try { res.json({ status:'ok', total: await dbCount(), regStatus, db:'supabase' }); }
  catch(e) { res.status(500).json({ status:'error', error:e.message }); }
});

app.get('/api/health', async (req, res) => {
  try { res.json({ status:'ok', total: await dbCount(), db:'supabase', env: process.env.NODE_ENV||'production' }); }
  catch(e) { res.status(500).json({ status:'error', error:e.message }); }
});

app.post('/api/test-email', async (req, res) => {
  try {
    if (!transporter) return res.status(400).json({ success:false, error:'Email haijasanidiwa (SMTP_USER/SMTP_PASS)' });
    const info = await transporter.sendMail({ from:`"Tabora Boys" <${SMTP_USER}>`, to:SCHOOL_EMAIL, subject:'Test ✅', html:'<p>Mfumo unafanya kazi mtandaoni! 🎉</p>' });
    res.json({ success:true, messageId:info.messageId });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// Single clean register route
app.post('/api/register', upload.single('pdf'), async (req, res) => {
  const pdfFile = req.file || null;
  let studentId = null;
  try {
    const d         = JSON.parse(req.body.studentData);
    const formLevel = d.formLevel || 'form1';
    const isF5      = formLevel === 'form5';

    if (regStatus[formLevel] && !regStatus[formLevel].open) {
      return res.status(403).json({ success:false, error:'Usajili umefungwa', message: regStatus[formLevel]?.message });
    }

    const fullName = [d.jina1,d.jina2,d.jina3].filter(Boolean).join(' ') || 'Haijajazwa';
    const date     = new Date().toLocaleString('en-GB', { timeZone:'Africa/Dar_es_Salaam' });
    const formLabel= isF5 ? 'Kidato cha 5' : 'Kidato cha Kwanza';

    console.log(`New: ${formLabel} | ${fullName}`);

    studentId = await dbInsert({
      form: isF5?'f5':'f1', form_level:formLevel,
      jina1:d.jina1||null, jina2:d.jina2||null, jina3:d.jina3||null, full_name:fullName,
      admission_no:d.admissionNo||null, tarehe:d.tarehe||null, jinsia:d.jinsia||null,
      wilaya_kuzaliwa:d.wilayaKuzaliwa||null, uraia:d.uraia||null, dini:d.dini||null,
      shule_iliyotoka:d.shuleIliyotoka||null, mkoa:d.mkoa||null, wilaya_makazi:d.wilayaMakazi||null,
      tarafa:d.tarafa||null, kata:d.kata||null, kijiji:d.kijiji||null, nambari_nyumba:d.nambariNyumba||null,
      baba_njina:d.babaNjina||null, baba_simu:d.babaSimu||null,
      mama_njina:d.mamaNjina||null, mama_simu:d.mamaSimu||null,
      mlezi_jina:d.mleziJina||null, mlezi_simu:d.mleziSimu||null,
      ndugu_jina:d.nduguJina||null, ndugu_simu:d.nduguSimu||null,
      mzazi_jina:d.mzaziJina||null, uhusiano:d.uhusiano||null,
      mzazi_simu_kuu:d.mzaziSimuKuu||d.babaSimu||null,
      mzazi_anwani:d.mzaziAnwani||null, mzazi_email:d.mzaziEmail||null,
      damu:d.damu||null, bima:d.bima||null, bima_aina:d.bimaAina||null,
      magonjwa:d.magonjwa||null, cheeti_status:d.cheetiStatus||null, fomu_d:d.fomuD||null,
      combination:    isF5?(d.combination||null):null,
      index_no_olevel:isF5?(d.indexNoOlevel||null):null,
      csee_year:      isF5?(d.cseeYear||null):null,
      csee_division:  isF5?(d.cseeDivision||null):null,
      csee_points:    isF5?(d.cseePoints||null):null,
      csee_aggregates:isF5?(d.cseeAggregates||null):null,
      results_json:   isF5?(d.results||null):null,
      registration_date:date, email_sent:false, raw_json:d
    });
    console.log(`Saved to Supabase — ID: ${studentId}`);

    let uploadedPdf = null;
    const attachments = [];
    if (pdfFile?.buffer?.length) {
      attachments.push({ filename:`TaboraBoys_${formLabel.replace(/\s+/g,'_')}_${fullName.replace(/\s+/g,'_')}_2026.pdf`, content:pdfFile.buffer, contentType:pdfFile.mimetype||'application/pdf' });
      uploadedPdf = await uploadPdf({ buffer:pdfFile.buffer, contentType:pdfFile.mimetype, fileName:pdfFile.originalname, studentId });
      if (uploadedPdf?.ok) {
        await dbUpdate(studentId, { pdf_filename:uploadedPdf.path });
        console.log('PDF saved:', uploadedPdf.path);
      }
    }

    const info = await transporter.sendMail({
      from:`"Tabora Boys Registration" <${SMTP_USER}>`,
      to:SCHOOL_EMAIL,
      subject:`🎓 Usajili: ${fullName} | ${formLabel}${d.combination?' — '+d.combination:''} | ${date}`,
      html:buildEmail(d, fullName, date, isF5),
      attachments
    });
    await dbUpdate(studentId, { email_sent:true, email_message_id:info.messageId });
    console.log(`Done — ID:${studentId}`);

    res.json({ success:true, message:'Umehifadhiwa mtandaoni!', studentId, emailSent:true, pdfStored:uploadedPdf?.ok?{bucket:uploadedPdf.bucket,path:uploadedPdf.path}:null });
  } catch(err) {
    console.error('Register error:', err.message);
    res.status(500).json({ success:false, error:err.message, studentId });
  }
});

app.get('/api/admin/students', async (req,res) => {
  const page=Math.max(1,parseInt(req.query.page||'1',10)), limit=Math.min(100,parseInt(req.query.limit||'20',10));
  try { const {rows,total}=await dbPage(page,limit); res.json({success:true,page,limit,total,pages:Math.ceil(total/limit),data:rows}); }
  catch(e){ res.status(500).json({success:false,error:e.message}); }
});

app.get('/api/admin/students/:id', async (req,res) => {
  try { const row=await dbGetById(req.params.id); if(!row)return res.status(404).json({success:false,error:'Hapatikani'}); res.json({success:true,data:row}); }
  catch(e){ res.status(500).json({success:false,error:e.message}); }
});

app.get('/api/admin/search', async (req,res) => {
  const q=(req.query.q||'').trim(); if(!q)return res.json({success:true,count:0,data:[]});
  try {
    const {data,error}=await supabase.from('students').select('id,created_at,full_name,admission_no,form_level,combination,shule_iliyotoka,email_sent').or(`full_name.ilike.%${q}%,admission_no.ilike.%${q}%,shule_iliyotoka.ilike.%${q}%`).order('id',{ascending:false}).limit(50);
    if(error)throw new Error(error.message);
    res.json({success:true,count:(data||[]).length,data:data||[]});
  } catch(e){ res.status(500).json({success:false,error:e.message}); }
});

app.get('/api/admin/stats', async (req,res) => {
  try {
    const [a,b,c,d]=await Promise.all([
      supabase.from('students').select('id',{count:'exact',head:true}),
      supabase.from('students').select('id',{count:'exact',head:true}).eq('email_sent',true),
      supabase.from('students').select('id',{count:'exact',head:true}).eq('form_level','form1'),
      supabase.from('students').select('id',{count:'exact',head:true}).eq('form_level','form5'),
    ]);
    res.json({success:true,total:a.count||0,emailSent:b.count||0,form1:c.count||0,form5:d.count||0});
  } catch(e){ res.status(500).json({success:false,error:e.message}); }
});

app.get('/api/admin/export/json', async (req,res) => {
  try {
    const {data,error}=await supabase.from('students').select('*').order('id');
    if(error)throw new Error(error.message);
    res.setHeader('Content-Disposition','attachment; filename="tabora_boys_2026.json"');
    res.setHeader('Content-Type','application/json');
    res.send(JSON.stringify(data||[],null,2));
  } catch(e){ res.status(500).json({success:false,error:e.message}); }
});

app.get('/api/admin/export/csv', async (req,res) => {
  try {
    const {data,error}=await supabase.from('students').select('*').order('id');
    if(error)throw new Error(error.message);
    const rows=data||[]; if(!rows.length)return res.send('Hakuna data');
    const esc=v=>{if(v==null)return'';const s=String(v);return(s.includes(',')||s.includes('"')||s.includes('\n'))?`"${s.replace(/"/g,'""')}"`:`${s}`;};
    const keys=Object.keys(rows[0]);
    res.setHeader('Content-Disposition','attachment; filename="tabora_boys_2026.csv"');
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.send('\uFEFF'+[keys.join(','),...rows.map(r=>keys.map(k=>esc(r[k])).join(','))].join('\r\n'));
  } catch(e){ res.status(500).json({success:false,error:e.message}); }
});

app.delete('/api/admin/students/:id', async (req,res) => {
  try { await dbDelete(req.params.id); res.json({success:true,message:`ID ${req.params.id} imefutwa`}); }
  catch(e){ res.status(500).json({success:false,error:e.message}); }
});

app.get('/api/admin/students/:id/pdf', async (req,res) => {
  try {
    const row=await dbGetById(req.params.id);
    if(!row)return res.status(404).json({success:false,error:'Hapatikani'});
    if(!row.pdf_filename)return res.status(404).json({success:false,error:'Hakuna PDF'});
    const {data,error}=await supabase.storage.from(PDF_BUCKET).createSignedUrl(row.pdf_filename,SIGNED_TTL);
    if(error||!data?.signedUrl)return res.status(500).json({success:false,error:error?.message});
    res.json({success:true,signedUrl:data.signedUrl,name:row.full_name});
  } catch(e){ res.status(500).json({success:false,error:e.message}); }
});

app.get('/api/registration-status', (req,res) => {
  const form=req.query.form||'form1';
  if(!regStatus[form])return res.status(404).json({error:'Fomu haijulikani'});
  res.json(regStatus[form]);
});

app.post('/api/registration-status', async (req,res) => {
  const {form,open,message,deadline}=req.body;
  if(!form||!regStatus[form])return res.status(400).json({error:'form lazima iwe form1 au form5'});
  regStatus[form]={open:open===true||open==='true',message:message||'',deadline:deadline||''};
  try { await setJsonSetting(SETTINGS_KEYS.regStatus, regStatus); res.json({success:true,form,status:regStatus[form]}); }
  catch(e){ res.status(500).json({success:false,error:e.message}); }
});

app.get('/api/pdf-layout', (req,res) => res.json(pdfLayouts[req.query.form||'form1']||{}));

app.post('/api/pdf-layout', async (req,res) => {
  const {form,layout}=req.body;
  if(!form||!['form1','form5'].includes(form))return res.status(400).json({error:'form lazima iwe form1 au form5'});
  pdfLayouts[form]=layout||{};
  try { await setJsonSetting(SETTINGS_KEYS.pdfLayouts, pdfLayouts); res.json({success:true,form}); }
  catch(e){ res.status(500).json({success:false,error:e.message}); }
});

// ── NIDA store (online duplicate checking) ──────────────────────
app.get('/api/nida/exists', async (req,res) => {
  const nida = normalizeNida(req.query.nida);
  if (!nida) return res.status(400).json({ success:false, error:'nida inahitajika' });
  try {
    const store = await getJsonSetting(SETTINGS_KEYS.nidaStore, { nidas: [] });
    const list = Array.isArray(store?.nidas) ? store.nidas : [];
    res.json({ success:true, nida, exists: list.includes(nida) });
  } catch(e) {
    res.status(500).json({ success:false, error:e.message });
  }
});

app.post('/api/nida', async (req,res) => {
  const nida = normalizeNida(req.body?.nida);
  if (!nida) return res.status(400).json({ success:false, error:'nida inahitajika' });
  try {
    const store = await getJsonSetting(SETTINGS_KEYS.nidaStore, { nidas: [] });
    const list = Array.isArray(store?.nidas) ? store.nidas : [];
    if (!list.includes(nida)) list.push(nida);
    await setJsonSetting(SETTINGS_KEYS.nidaStore, { nidas: list });
    res.json({ success:true, nida, stored:true });
  } catch(e) {
    res.status(500).json({ success:false, error:e.message });
  }
});

// ── Admin: form edits persistence ───────────────────────────────
app.get('/api/admin/form-edits', async (req,res) => {
  const form = req.query.form === 'form5' ? 'form5' : 'form1';
  const key  = form === 'form5' ? SETTINGS_KEYS.formEditsForm5 : SETTINGS_KEYS.formEditsForm1;
  try {
    const edits = await getJsonSetting(key, {});
    res.json({ success:true, form, edits: edits && typeof edits === 'object' ? edits : {} });
  } catch(e) {
    res.status(500).json({ success:false, error:e.message });
  }
});

app.post('/api/admin/form-edits', async (req,res) => {
  const form = req.body?.form === 'form5' ? 'form5' : 'form1';
  const key  = form === 'form5' ? SETTINGS_KEYS.formEditsForm5 : SETTINGS_KEYS.formEditsForm1;
  const edits = req.body?.edits;
  if (!edits || typeof edits !== 'object') return res.status(400).json({ success:false, error:'edits lazima iwe object' });
  try {
    await setJsonSetting(key, edits);
    res.json({ success:true, form });
  } catch(e) {
    res.status(500).json({ success:false, error:e.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT} | DB: Supabase`));
module.exports = app;
