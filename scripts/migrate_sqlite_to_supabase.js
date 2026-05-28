/* eslint-disable no-console */
const path = require('path');
const Database = require('better-sqlite3');
const { createClient } = require('@supabase/supabase-js');

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env ${name}. Put it in .env then re-run.`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const SUPABASE_URL = required('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = required('SUPABASE_SERVICE_ROLE_KEY');
  const SQLITE_PATH = process.env.SQLITE_PATH || path.join(__dirname, '..', 'tabora_boys.db');
  const BATCH = Math.max(10, parseInt(process.env.BATCH || '250', 10));

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  const rows = sqlite.prepare('SELECT * FROM students ORDER BY id').all();
  console.log(`SQLite rows: ${rows.length}`);

  // Map SQLite schema -> Postgres schema (keep ids to preserve references)
  const mapped = rows.map(r => ({
    id: r.id,
    created_at: r.created_at ? new Date(r.created_at) : null,
    jina1: r.jina1,
    jina2: r.jina2,
    jina3: r.jina3,
    full_name: r.full_name,
    admission_no: r.admission_no,
    tarehe: r.tarehe,
    mwezi: r.mwezi,
    mwaka: r.mwaka,
    wilaya_kuzaliwa: r.wilaya_kuzaliwa,
    uraia: r.uraia,
    dini: r.dini,
    shule_iliyotoka: r.shule_iliyotoka,
    mkoa: r.mkoa,
    wilaya_makazi: r.wilaya_makazi,
    tarafa: r.tarafa,
    kata: r.kata,
    kijiji: r.kijiji,
    nambari_nyumba: r.nambari_nyumba,
    mwenyekiti_jina: r.mwenyekiti_jina,
    mwenyekiti_simu: r.mwenyekiti_simu,
    mtendaji_jina: r.mtendaji_jina,
    baba_njina: r.baba_njina,
    baba_simu: r.baba_simu,
    mama_njina: r.mama_njina,
    mama_simu: r.mama_simu,
    mlezi_jina: r.mlezi_jina,
    mlezi_simu: r.mlezi_simu,
    ndugu_jina: r.ndugu_jina,
    ndugu_simu: r.ndugu_simu,
    mzazi_jina: r.mzazi_jina,
    uhusiano: r.uhusiano,
    mzazi_simu_kuu: r.mzazi_simu_kuu,
    mzazi_anwani: r.mzazi_anwani,
    mzazi_email: r.mzazi_email,
    damu: r.damu,
    bima: r.bima,
    bima_aina: r.bima_aina,
    magonjwa: r.magonjwa,
    cheeti_status: r.cheeti_status,
    fomu_d: r.fomu_d,
    registration_date: r.registration_date,
    email_sent: !!r.email_sent,
    email_message_id: r.email_message_id,
    pdf_filename: r.pdf_filename,
    raw_json: r.raw_json ? safeJsonParse(r.raw_json) : null,
    form_level: r.form_level || 'form1',
    combination: r.combination,
    index_no_olevel: r.index_no_olevel,
    csee_year: r.csee_year,
    csee_division: r.csee_division,
    csee_points: r.csee_points,
    csee_aggregates: r.csee_aggregates,
    csee_index_no: r.csee_index_no,
    results_json: r.results_json ? safeJsonParse(r.results_json) : null,
    jinsia: r.jinsia
  }));

  // Insert in batches
  for (let i = 0; i < mapped.length; i += BATCH) {
    const batch = mapped.slice(i, i + BATCH);
    const { error } = await supabase.from('students').upsert(batch, { onConflict: 'id' });
    if (error) {
      console.error('Batch failed at', i, error);
      process.exit(1);
    }
    console.log(`Upserted ${Math.min(i + BATCH, mapped.length)}/${mapped.length}`);
  }

  console.log('NOTE: If you preserved IDs, run this once in Supabase SQL editor:');
  console.log("select setval(pg_get_serial_sequence('public.students','id'), (select coalesce(max(id),1) from public.students));");

  console.log('Done.');
  sqlite.close();
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});

