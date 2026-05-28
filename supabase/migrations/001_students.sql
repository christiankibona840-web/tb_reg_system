-- Create `students` table in Supabase Postgres.
-- Run this in Supabase SQL editor (or `supabase db push` if you use CLI).

create table if not exists public.students (
  id bigserial primary key,
  created_at timestamptz not null default now(),

  jina1 text,
  jina2 text,
  jina3 text,
  full_name text not null,
  admission_no text,
  tarehe text,
  mwezi text,
  mwaka text,
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
  mwenyekiti_jina text,
  mwenyekiti_simu text,
  mtendaji_jina text,
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
  registration_date text,

  email_sent boolean not null default false,
  email_message_id text,

  -- In the migrated backend this stores the Supabase Storage object path (not a local filename)
  pdf_filename text,

  raw_json jsonb,

  -- Form 5 extra fields
  form_level text default 'form1',
  combination text,
  index_no_olevel text,
  csee_year text,
  csee_division text,
  csee_points text,
  csee_aggregates text,
  csee_index_no text,
  results_json jsonb,
  jinsia text
);

create index if not exists idx_students_full_name on public.students (full_name);
create index if not exists idx_students_created_at on public.students (created_at);
create index if not exists idx_students_admission_no on public.students (admission_no);
create index if not exists idx_students_form_level on public.students (form_level);
create index if not exists idx_students_combination on public.students (combination);

-- Simple admin stats as JSON to avoid complex PostgREST group-by logic in Node.
create or replace function public.admin_students_stats()
returns jsonb
language sql
stable
as $$
  with
    totals as (
      select
        count(*)::int as total,
        count(*) filter (where email_sent = true)::int as email_sent
      from public.students
    ),
    by_blood as (
      select coalesce(jsonb_agg(jsonb_build_object('label', damu, 'n', n) order by n desc), '[]'::jsonb) as v
      from (
        select damu, count(*)::int as n
        from public.students
        where damu is not null
        group by damu
      ) x
    ),
    by_religion as (
      select coalesce(jsonb_agg(jsonb_build_object('label', dini, 'n', n) order by n desc), '[]'::jsonb) as v
      from (
        select dini, count(*)::int as n
        from public.students
        where dini is not null
        group by dini
      ) x
    ),
    by_school as (
      select coalesce(jsonb_agg(jsonb_build_object('label', shule_iliyotoka, 'n', n) order by n desc), '[]'::jsonb) as v
      from (
        select shule_iliyotoka, count(*)::int as n
        from public.students
        where shule_iliyotoka is not null
        group by shule_iliyotoka
        order by n desc
        limit 10
      ) x
    ),
    per_day as (
      select coalesce(jsonb_agg(jsonb_build_object('day', day, 'n', n) order by day desc), '[]'::jsonb) as v
      from (
        select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day, count(*)::int as n
        from public.students
        group by 1
        order by 1 desc
        limit 14
      ) x
    )
  select jsonb_build_object(
    'total', (select total from totals),
    'emailSent', (select email_sent from totals),
    'emailPending', (select total - email_sent from totals),
    'byBlood', (select v from by_blood),
    'byReligion', (select v from by_religion),
    'bySchool', (select v from by_school),
    'perDay', (select v from per_day)
  );
$$;

