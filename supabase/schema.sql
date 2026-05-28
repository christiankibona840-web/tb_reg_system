-- Supabase schema for Tabora Boys Registration
-- Run this in Supabase SQL editor.

-- 1) Students table (stores registrations)
create table if not exists public.students (
  id bigserial primary key,
  created_at timestamptz not null default now(),

  -- basic identity
  full_name text,
  admission_no text,
  form text,
  form_level text,
  combination text,

  -- common form fields (subset; raw_json holds full payload)
  jina1 text,
  jina2 text,
  jina3 text,
  tarehe text,
  jinsia text,
  wilaya_kuzaliwa text,
  uraia text,
  dini text,
  shule_iliyotoka text,
  mkoa text,
  wilaya_makazi text,
  tarafa text,
  kata text,
  kijiji text,
  nambari_nyumba text,

  baba_njina text,
  baba_simu text,
  mama_njina text,
  mama_simu text,
  mlezi_jina text,
  mlezi_simu text,
  ndugu_jina text,
  ndugu_simu text,
  mzazi_jina text,
  uhusiano text,
  mzazi_simu_kuu text,
  mzazi_anwani text,
  mzazi_email text,

  damu text,
  bima text,
  bima_aina text,
  magonjwa text,
  cheeti_status text,
  fomu_d text,

  -- form5 extras
  index_no_olevel text,
  csee_year text,
  csee_division text,
  csee_points text,
  csee_aggregates text,
  results_json jsonb,

  -- operational fields
  registration_date text,
  email_sent boolean not null default false,
  email_message_id text,
  pdf_filename text,
  raw_json jsonb
);

create index if not exists students_created_at_idx on public.students(created_at desc);
create index if not exists students_full_name_idx on public.students(full_name);
create index if not exists students_admission_no_idx on public.students(admission_no);

-- 2) Settings KV table (reg_status, pdf_layouts, nida_store, form edits)
create table if not exists public.settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

-- Keep updated_at fresh on update
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists settings_touch_updated_at on public.settings;
create trigger settings_touch_updated_at
before update on public.settings
for each row execute procedure public.touch_updated_at();

-- 3) Storage bucket
-- Create bucket in Supabase UI (Storage) named: registrations
-- Then (optional) set bucket policy depending on whether you use service role key on server.

-- 4) RLS guidance (recommended: server uses service role, so RLS can stay enabled/strict)
-- If you insist on using only anon key in server:
-- - You must create RLS policies that allow inserts/updates/deletes from the server.
-- - This is not recommended because anon key can be abused.

