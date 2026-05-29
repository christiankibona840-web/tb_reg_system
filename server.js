const express          = require('express');
const nodemailer       = require('nodemailer');
const cors             = require('cors');
const multer           = require('multer');
const path             = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 5000;

// ══════════════════════════════════════════════════════════════
//  ENVIRONMENT VALIDATION — server stops if keys are missing
// ══════════════════════════════════════════════════════════════
const MISSING = ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SMTP_USER','SMTP_PASS'].filter(k => !process.env[k]);
if (MISSING.length) {
  console.error('❌  Missing environment variables:', MISSING.join(', '));
  console.error('    Add them in Railway → your project → Variables tab.');
  process.exit(1);
}

// ══════════════════════════════════════════════════════════════
//  CONFIG  (everything from environment variables — no hardcoding)
// ══════════════════════════════════════════════════════════════
const SCHOOL_EMAIL   = process.env.SCHOOL_EMAIL  || process.env.SMTP_USER;
const FRONTEND_URL   = process.env.FRONTEND_URL  || '*';  // e.g. https://tabora-boys.vercel.app
const PDF_BUCKET     = process.env.SUPABASE_PDF_BUCKET || 'registrations';
const PDF_PREFIX     = process.env.SUPABASE_PDF_PREFIX || 'registrations';
const SIGNED_URL_TTL = Math.max(60, parseInt(process.env.SUPABASE_SIGNED_URL_TTL || '3600', 10));

// ══════════════════════════════════════════════════════════════
//  SUPABASE  (only database — no SQLite, no local files)
// ══════════════════════════════════════════════════════════════
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);
console.log('✅ Supabase connected');

// ══════════════════════════════════════════════════════════════
//  CORS  — allow your Vercel frontend + local dev
// ══════════════════════════════════════════════════════════════
const ALLOWED = [
  FRONTEND_URL,
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:3000',
].filter(o => o && o !== '*');

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (FRONTEND_URL === '*' || ALLOWED.some(o => origin.startsWith(o))) return cb(null, true);
    console.warn('🚫 CORS blocked:', origin);
    cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET','POST','DELETE','OPTIONS'],
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname)));
const upload = multer({ storage: multer.memoryStorage() });

// ══════════════════════════════════════════════════════════════
//  EMAIL
// ══════════════════════════════════════════════════════════════
const transporter = nodemailer.createTransport({
  service: process.env.SMTP_SERVICE || 'gmail',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});
transporter.verify(err => {
  if (err) console.error('❌ Email error:', err.message);
  else     console.log('✅ Email ready →', process.env.SMTP_USER);
});

// ══════════════════════════════════════════════════════════════
//  DATABASE HELPERS  (Supabase only)
// ══════════════════════════════════════════════════════════════
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
async function dbPage(page, limit) {
  const from = (page-1)*limit;
  const { data, count, error } = await supabase.from('students')
    .select('id,created_at,full_name,admission_no,form_level,combination,shule_iliyotoka,mzazi_simu_kuu,damu,email_sent,registration_date', { count:'exact' })
    .order('id',{ascending:false}).range(from, from+limit-1);
  if (error) throw new Error(error.message);
  return { rows: data||[], total: count||0 };
}

// ══════════════════════════════════════════════════════════════
//  SETTINGS  — reg_status and pdf_layouts saved to Supabase
//  (replaces reg_status.json and pdf_layouts.json local files)
// ══════════════════════════════════════════════════════════════
async function getSetting(key, fallback) {
  const { data } = await supabase.from('settings').select('value').eq('key',key).maybeSingle();
  return data ? data.value : fallback;
}
async function setSetting(key, value) {
  const { error } = await supabase.from('settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict:'key' });
  if (error) throw new Error(error.message);
}

// In-memory cache — reloaded from Supabase on every startup
let regStatus = {
  form1: { open:true, message:'Usajili wa Kidato cha Kwanza umefungwa.', deadline:'' },
  form5: { open:true, message:'Usajili wa Kidato cha 5 umefungwa.',      deadline:'' }
};
let pdfLayouts = { form1:{}, form5:{} };

(async () => {
  try {
    const [rs, pl] = await Promise.all([
      getSetting('reg_status',  regStatus),
      getSetting('pdf_layouts', pdfLayouts)
    ]);
    Object.assign(regStatus,  rs);
    Object.assign(pdfLayouts, pl);
    console.log('✅ Settings loaded from Supabase');
  } catch(e) {
    console.warn('⚠️  Settings load failed (using defaults):', e.message);
  }
})();

// ══════════════════════════════════════════════════════════════
//  PDF STORAGE
// ══════════════════════════════════════════════════════════════
async function uploadPdf({ buffer, contentType, fileName, studentId }) {
  const safe = String(fileName||`reg-${Date.now()}.pdf`).replace(/[^\w.\-]+/g,'_');
  const p    = `${PDF_PREFIX}/${studentId}/${Date.now()}-${safe}`;
  const { data, error } = await supabase.storage.from(PDF_BUCKET)
    .upload(p, buffer, { contentType: contentType||'application/pdf', upsert:false });
  return error ? { ok:false, error:error.message } : { ok:true, bucket:PDF_BUCKET, path:data.path };
}

// ══════════════════════════════════════════════════════════════
//  EMAIL BUILDERS
// ══════════════════════════════════════════════════════════════
function buildEmailHTML(d, name, date) {
  const R = (l,v) => `<tr><td style="padding:8px 14px;font-weight:600;color:#555;background:#f7f9fc;width:38%;border-bottom:1px solid #eef2f7;">${l}</td><td style="padding:8px 14px;color:#1a1a2e;border-bottom:1px solid #eef2f7;">${v||'—'}</td></tr>`;
  const S = (ic,t,rows) => `<div style="margin-bottom:20px;"><div style="background:#1a365d;color:white;padding:8px 14px;font-size:13px;font-weight:700;border-radius:6px 6px 0 0;">${ic} ${t}</div><table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #dde3ed;border-top:none;">${rows}</table></div>`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;background:#f0f4f8;font-family:Arial,sans-serif;">
<div style="max-width:650px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1);">
<div style="background:linear-gradient(135deg,#0d1f3c,#1a365d);padding:28px 32px;"><div style="color:white;font-size:17px;font-weight:800;">🏫 SHULE YA SEKONDARI TABORA WAVULANA</div><div style="color:#f0c84a;font-size:11px;margin-top:3px;">Usajili Mpya — Kidato cha Kwanza 2026</div></div>
<div style="padding:16px 28px;background:#e8f5e9;border-left:4px solid #2d6a4f;"><strong style="color:#1b5e20;">✅ ${name} — ${date}</strong></div>
<div style="padding:24px 28px;">
${S('👤','TAARIFA ZA KIBINAFSI',R('Jina Kamili','<strong>'+name+'</strong>')+R('Tarehe ya Kuzaliwa',[d.tarehe,d.mwezi,d.mwaka].filter(Boolean).join('/'))+R('Wilaya ya Kuzaliwa',d.wilayaKuzaliwa)+R('Uraia',d.uraia)+R('Dini',d.dini)+R('Shule Iliyotoka',d.shuleIliyotoka)+R('Namba Usajili',d.admissionNo||'—')+R('Mkoa/Wilaya',[d.mkoa,d.wilayaMakazi].filter(Boolean).join(' / '))+R('Kata/Kijiji',[d.kata,d.kijiji].filter(Boolean).join(' / ')))}
${S('👨‍👩‍👦','FAMILIA',R('Baba',d.babaNjina)+R('Simu ya Baba',d.babaSimu)+R('Mama',d.mamaNjina)+R('Simu ya Mama',d.mamaSimu)+R('Mlezi',[d.mleziJina,d.mleziSimu].filter(Boolean).join(' — ')))}
${S('🏥','AFYA',R('Kundi la Damu','<strong style="color:#c0392b;">'+d.damu+'</strong>')+R('Bima',d.bima)+R('Magonjwa',d.magonjwa||'Hakuna'))}
</div>
<div style="background:#f7f9fc;padding:16px 28px;text-align:center;font-size:11px;color:#888;"><strong>Shule ya Sekondari Tabora Wavulana</strong><br>S.L.P 374, Tabora · 0755 297 005</div>
</div></body></html>`;
}

function buildForm5EmailHTML(d, name, date) {
  const R = (l,v) => `<tr><td style="padding:8px 14px;font-weight:600;color:#555;background:#f7f9fc;width:38%;border-bottom:1px solid #eef2f7;">${l}</td><td style="padding:8px 14px;color:#1a1a2e;border-bottom:1px solid #eef2f7;">${v||'—'}</td></tr>`;
  const S = (ic,t,rows) => `<div style="margin-bottom:20px;"><div style="background:#553c9a;color:white;padding:8px 14px;font-size:13px;font-weight:700;border-radius:6px 6px 0 0;">${ic} ${t}</div><table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #dde3ed;border-top:none;">${rows}</table></div>`;
  const COMBOS={PCB:'Physics, Chemistry & Biology',PAM:'Physics, Adv. Maths & Further Maths',HGL:'History, Geography & Literature',PMC:'Physics, Mathematics & Chemistry'};
  const rr=(d.results||[]).map(r=>R(r.subject,`${r.grade} (${r.points} pts)`)).join('')||R('Matokeo','Hayakuingizwa');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;background:#f0f4f8;font-family:Arial,sans-serif;">
<div style="max-width:650px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1);">
<div style="background:linear-gradient(135deg,#2d1b69,#553c9a);padding:28px 32px;"><div style="color:white;font-size:17px;font-weight:800;">🏫 SHULE YA SEKONDARI TABORA WAVULANA</div><div style="color:#e9d8fd;font-size:11px;margin-top:3px;">Usajili Mpya — Kidato cha 5 2026</div></div>
<div style="padding:16px 28px;background:#faf5ff;border-left:4px solid #553c9a;"><strong style="color:#2d1b69;">✅ ${name} | Mkondo: ${d.combination||'—'} — ${date}</strong></div>
<div style="padding:24px 28px;">
<div style="background:#e9d8fd;border-radius:8px;padding:12px 16px;margin-bottom:20px;"><strong style="color:#2d1b69;font-size:16px;">Mkondo: ${d.combination||'—'}</strong> <span style="color:#553c9a;font-size:12px;">${COMBOS[d.combination]||''}</span></div>
${S('👤','TAARIFA ZA KIBINAFSI',R('Jina Kamili','<strong>'+name+'</strong>')+R('Tarehe',d.tarehe||'—')+R('Uraia',d.uraia)+R('Dini',d.dini)+R('Shule ya O-Level',d.shuleIliyotoka)+R('Index No',d.indexNoOlevel||'—')+R('Namba Usajili',d.admissionNo||'—'))}
${S('📊','MATOKEO YA CSEE',R('Mwaka',d.cseeYear||'—')+R('Daraja',d.cseeDivision?'Division '+d.cseeDivision:'—')+R('Aggregate',d.cseeAggregates||'—')+rr)}
${S('👨‍👩‍👦','FAMILIA',R('Baba',d.babaNjina)+R('Simu ya Baba',d.babaSimu)+R('Mama',d.mamaNjina)+R('Simu ya Mama',d.mamaSimu))}
</div>
<div style="background:#f7f9fc;padding:16px 28px;text-align:center;font-size:11px;color:#888;"><strong style="color:#553c9a;">Shule ya Sekondari Tabora Wavulana</strong><br>S.L.P 374, Tabora · 0755 297 005</div>
</div></body></html>`;
}

// ══════════════════════════════════════════════════════════════
//  ROUTES
// ══════════════════════════════════════════════════════════════
app.get('/api/status', async (req, res) => {
  try {
    const { count } = await supabase.from('students').select('id',{count:'exact',head:true});
    res.json({ status:'ok', total_registrations:count||0, regStatus, db:'supabase' });
  } catch(e) { res.status(500).json({ status:'error', error:e.message }); }
});

app.get('/api/health', async (req, res) => {
  try {
    const { count } = await supabase.from('students').select('id',{count:'exact',head:true});
    res.json({ status:'ok', total:count||0 });
  } catch(e) { res.status(500).json({ status:'error', error:e.message }); }
});

app.post('/api/test-email', async (req, res) => {
  try {
    const info = await transporter.sendMail({ from:`"Tabora Boys" <${process.env.SMTP_USER}>`, to:SCHOOL_EMAIL, subject:'Test ✅', html:'<p>Mfumo wa barua pepe unafanya kazi!</p>' });
    res.json({ success:true, messageId:info.messageId });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// ── Single /api/register (no duplicates) ──────────────────────
app.post('/api/register', upload.single('pdf'), async (req, res) => {
  let studentId = null;
  try {
    const d         = JSON.parse(req.body.studentData);
    const formLevel = d.formLevel || 'form1';

    if (regStatus[formLevel] && !regStatus[formLevel].open) {
      return res.status(403).json({ success:false, error:'Usajili umefungwa', message:regStatus[formLevel]?.message });
    }

    const name  = [d.jina1,d.jina2,d.jina3].filter(Boolean).join(' ')||'Haijajazwa';
    const date  = new Date().toLocaleString('en-GB',{timeZone:'Africa/Dar_es_Salaam'});
    const label = formLevel==='form5' ? 'Kidato cha 5' : 'Kidato cha Kwanza';
    console.log(`📥 ${label} | ${name}`);

    studentId = await dbInsert({
      form:            formLevel==='form5'?'f5':'f1',
      form_level:      formLevel,
      jina1:           d.jina1||null,  jina2:d.jina2||null,  jina3:d.jina3||null,
      full_name:       name,
      admission_no:    d.admissionNo||null,
      tarehe:          d.tarehe||null,
      jinsia:          d.jinsia||null,
      wilaya_kuzaliwa: d.wilayaKuzaliwa||null,
      uraia:           d.uraia||null,
      dini:            d.dini||null,
      shule_iliyotoka: d.shuleIliyotoka||null,
      mkoa:            d.mkoa||null,     wilaya_makazi:d.wilayaMakazi||null,
      tarafa:          d.tarafa||null,   kata:d.kata||null,
      kijiji:          d.kijiji||null,   nambari_nyumba:d.nambariNyumba||null,
      baba_njina:      d.babaNjina||null, baba_simu:d.babaSimu||null,
      mama_njina:      d.mamaNjina||null, mama_simu:d.mamaSimu||null,
      mlezi_jina:      d.mleziJina||null, mlezi_simu:d.mleziSimu||null,
      ndugu_jina:      d.nduguJina||null, ndugu_simu:d.nduguSimu||null,
      mzazi_jina:      d.mzaziJina||null, uhusiano:d.uhusiano||null,
      mzazi_simu_kuu:  d.mzaziSimuKuu||d.babaSimu||null,
      mzazi_anwani:    d.mzaziAnwani||null, mzazi_email:d.mzaziEmail||null,
      damu:            d.damu||null, bima:d.bima||null, bima_aina:d.bimaAina||null,
      magonjwa:        d.magonjwa||null, cheeti_status:d.cheetiStatus||null, fomu_d:d.fomuD||null,
      combination:     formLevel==='form5'?(d.combination||null):null,
      index_no_olevel: formLevel==='form5'?(d.indexNoOlevel||null):null,
      csee_year:       formLevel==='form5'?(d.cseeYear||null):null,
      csee_division:   formLevel==='form5'?(d.cseeDivision||null):null,
      csee_points:     formLevel==='form5'?(d.cseePoints||null):null,
      csee_aggregates: formLevel==='form5'?(d.cseeAggregates||null):null,
      results_json:    formLevel==='form5'?(d.results||null):null,
      registration_date: date, email_sent:false, raw_json:d
    });
    console.log(`💾 Saved → Supabase ID: ${studentId}`);

    const pdfFile = req.file||null;
    const attachments = [];
    let   up = null;
    if (pdfFile?.buffer?.length) {
      attachments.push({ filename:`TaboraBoys_${label.replace(/\s+/g,'_')}_${name.replace(/\s+/g,'_')}.pdf`, content:pdfFile.buffer, contentType:pdfFile.mimetype||'application/pdf' });
      up = await uploadPdf({ buffer:pdfFile.buffer, contentType:pdfFile.mimetype, fileName:pdfFile.originalname, studentId });
      if (up.ok) { await dbUpdate(studentId,{pdf_filename:up.path}); console.log(`📄 PDF → ${up.path}`); }
      else         console.warn('⚠️  PDF upload failed:', up.error);
    }

    const mail = await transporter.sendMail({
      from:`"Tabora Boys Registration" <${process.env.SMTP_USER}>`,
      to:SCHOOL_EMAIL,
      subject:`🎓 Usajili Mpya: ${name} | ${label} | ${date}`,
      html: formLevel==='form5' ? buildForm5EmailHTML(d,name,date) : buildEmailHTML(d,name,date),
      attachments
    });
    await dbUpdate(studentId,{email_sent:true, email_message_id:mail.messageId});
    console.log(`✅ Done — ID ${studentId}`);

    res.json({ success:true, message:'Usajili umefanikiwa!', studentId, emailSent:true, pdfStored:up?.ok?{bucket:up.bucket,path:up.path}:null });
  } catch(err) {
    console.error('❌ Register error:', err.message);
    res.status(500).json({ success:false, error:err.message, studentId });
  }
});

app.get('/api/admin/students', async (req,res) => {
  const page=Math.max(1,parseInt(req.query.page||'1',10)), limit=Math.min(100,parseInt(req.query.limit||'20',10));
  try { const {rows,total}=await dbPage(page,limit); res.json({success:true,page,limit,total,pages:Math.ceil(total/limit),data:rows}); }
  catch(e){res.status(500).json({success:false,error:e.message});}
});

app.get('/api/admin/students/:id', async (req,res) => {
  try { const row=await dbGetById(req.params.id); if(!row)return res.status(404).json({success:false,error:'Hapatikani'}); res.json({success:true,data:row}); }
  catch(e){res.status(500).json({success:false,error:e.message});}
});

app.get('/api/admin/search', async (req,res) => {
  const q=(req.query.q||'').trim();
  if(!q)return res.json({success:true,count:0,data:[]});
  try {
    const {data,error}=await supabase.from('students').select('id,created_at,full_name,admission_no,form_level,combination,shule_iliyotoka,mzazi_simu_kuu,email_sent')
      .or(`full_name.ilike.%${q}%,admission_no.ilike.%${q}%,shule_iliyotoka.ilike.%${q}%,baba_njina.ilike.%${q}%,mama_njina.ilike.%${q}%`)
      .order('id',{ascending:false}).limit(50);
    if(error)throw new Error(error.message);
    res.json({success:true,count:(data||[]).length,data:data||[]});
  } catch(e){res.status(500).json({success:false,error:e.message});}
});

app.get('/api/admin/stats', async (req,res) => {
  try {
    const [t,es,f1,f5]=await Promise.all([
      supabase.from('students').select('id',{count:'exact',head:true}),
      supabase.from('students').select('id',{count:'exact',head:true}).eq('email_sent',true),
      supabase.from('students').select('id',{count:'exact',head:true}).eq('form_level','form1'),
      supabase.from('students').select('id',{count:'exact',head:true}).eq('form_level','form5')
    ]);
    res.json({success:true,total:t.count||0,emailSent:es.count||0,form1:f1.count||0,form5:f5.count||0});
  } catch(e){res.status(500).json({success:false,error:e.message});}
});

app.get('/api/admin/summary', async (req,res) => {
  try {
    const [t,f1,f5]=await Promise.all([
      supabase.from('students').select('id',{count:'exact',head:true}),
      supabase.from('students').select('id',{count:'exact',head:true}).eq('form_level','form1'),
      supabase.from('students').select('id',{count:'exact',head:true}).eq('form_level','form5')
    ]);
    res.json({success:true,total:t.count||0,form1:f1.count||0,form5:f5.count||0,regStatus});
  } catch(e){res.status(500).json({success:false,error:e.message});}
});

app.get('/api/admin/export/json', async (req,res) => {
  try {
    const {data,error}=await supabase.from('students').select('*').order('id',{ascending:true});
    if(error)throw new Error(error.message);
    res.setHeader('Content-Disposition','attachment; filename="tabora_boys_2026.json"');
    res.setHeader('Content-Type','application/json');
    res.send(JSON.stringify(data||[],null,2));
  } catch(e){res.status(500).json({success:false,error:e.message});}
});

app.get('/api/admin/export/csv', async (req,res) => {
  try {
    const {data,error}=await supabase.from('students').select('*').order('id',{ascending:true});
    if(error)throw new Error(error.message);
    const rows=data||[];
    if(!rows.length)return res.send('Hakuna data');
    const esc=v=>{if(v==null)return'';const s=String(v);return(s.includes(',')||s.includes('"')||s.includes('\n'))?`"${s.replace(/"/g,'""')}"`  :s;};
    const h=Object.keys(rows[0]);
    const csv=[h.join(','),...rows.map(r=>h.map(k=>esc(r[k])).join(','))].join('\r\n');
    res.setHeader('Content-Disposition','attachment; filename="tabora_boys_2026.csv"');
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.send('\uFEFF'+csv);
  } catch(e){res.status(500).json({success:false,error:e.message});}
});

app.delete('/api/admin/students/:id', async (req,res) => {
  try { await dbDelete(req.params.id); res.json({success:true,message:`ID ${req.params.id} imefutwa`}); }
  catch(e){res.status(500).json({success:false,error:e.message});}
});

app.get('/api/admin/students/:id/pdf', async (req,res) => {
  try {
    const row=await dbGetById(req.params.id);
    if(!row)return res.status(404).json({success:false,error:'Hapatikani'});
    if(!row.pdf_filename)return res.status(404).json({success:false,error:'Hakuna PDF'});
    const {data,error}=await supabase.storage.from(PDF_BUCKET).createSignedUrl(row.pdf_filename,SIGNED_URL_TTL);
    if(error||!data?.signedUrl)return res.status(500).json({success:false,error:error?.message||'Imeshindikana'});
    res.json({success:true,id:row.id,name:row.full_name,signedUrl:data.signedUrl,expiresIn:SIGNED_URL_TTL});
  } catch(e){res.status(500).json({success:false,error:e.message});}
});

app.get('/api/registration-status', (req,res) => {
  const form=req.query.form||'form1';
  if(!regStatus[form])return res.status(404).json({error:'Fomu haijulikani'});
  res.json(regStatus[form]);
});

app.post('/api/registration-status', async (req,res) => {
  const {form,open,message,deadline}=req.body;
  if(!form||!regStatus[form])return res.status(400).json({error:'form lazima iwe form1 au form5'});
  regStatus[form]={open:open===true||open==='true', message:message||'', deadline:deadline||''};
  try { await setSetting('reg_status',regStatus); res.json({success:true,form,status:regStatus[form]}); }
  catch(e){res.status(500).json({success:false,error:e.message});}
});

app.get('/api/pdf-layout',(req,res)=>res.json(pdfLayouts[req.query.form||'form1']||{}));

app.post('/api/pdf-layout', async (req,res) => {
  const {form,layout}=req.body;
  if(!form||!['form1','form5'].includes(form))return res.status(400).json({error:'form lazima iwe form1 au form5'});
  pdfLayouts[form]=layout||{};
  try { await setSetting('pdf_layouts',pdfLayouts); res.json({success:true,form}); }
  catch(e){res.status(500).json({success:false,error:e.message});}
});

app.get('/api/admin/students/filter', async (req,res) => {
  const {form,combo}=req.query;
  const page=Math.max(1,parseInt(req.query.page||'1',10)),limit=Math.min(100,parseInt(req.query.limit||'20',10));
  try {
    let q=supabase.from('students').select('id,created_at,full_name,admission_no,form_level,combination,shule_iliyotoka,mzazi_simu_kuu,email_sent,registration_date',{count:'exact'}).order('id',{ascending:false}).range((page-1)*limit,page*limit-1);
    if(form) q=q.eq('form_level',form);
    if(combo)q=q.eq('combination',combo);
    const {data,count,error}=await q;
    if(error)throw new Error(error.message);
    res.json({success:true,page,limit,total:count||0,pages:Math.ceil((count||0)/limit),data:data||[]});
  } catch(e){res.status(500).json({success:false,error:e.message});}
});

// ══════════════════════════════════════════════════════════════
//  START
// ══════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  Tabora Boys — Registration Server (ONLINE MODE)             ║
║  Port     : ${PORT}                                             ║
║  Database : Supabase — ${(process.env.SUPABASE_URL||'').replace('https://','').split('.')[0]}          ║
║  Frontend : ${FRONTEND_URL}                      ║
╚══════════════════════════════════════════════════════════════╝`);
});

module.exports = app;

// ── Admin: form edits (save/load admin text edits) ─────────────
app.get('/api/admin/form-edits', async (req, res) => {
  const form = req.query.form || 'form1';
  try {
    const edits = await getSetting(`form_edits_${form}`, {});
    res.json({ success: true, form, edits });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/admin/form-edits', async (req, res) => {
  const { form, edits } = req.body;
  if (!form) return res.status(400).json({ error: 'form required' });
  try {
    await setSetting(`form_edits_${form}`, edits || {});
    res.json({ success: true, form });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});
