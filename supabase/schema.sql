-- Apply.ai database schema
-- Run this once in Supabase: Dashboard → SQL Editor → New query → paste → Run.

-- ───────────────────────── Profiles ─────────────────────────
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text,
  full_name     text,
  cv_path       text,            -- storage path in the "cvs" bucket
  cv_filename   text,
  cv_format     text check (cv_format in ('docx','pdf')),
  cv_text       text,            -- plain text of the CV
  cv_paragraphs jsonb,           -- [{i, text}] for DOCX, used for layout-preserving tailoring
  prefs         jsonb not null default '{}'::jsonb,  -- answers to the onboarding questions
  onboarded     boolean not null default false,
  last_hunter_at timestamptz,
  portal_status jsonb not null default '{}'::jsonb,  -- {linkedin:'ok'|'login_needed', ...}
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Create a profile row automatically when someone signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────── Extension tokens ─────────────────────
-- The Chrome extension authenticates with a long-lived token (stored hashed).
create table if not exists public.extension_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  token_hash   text not null unique,
  label        text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked      boolean not null default false
);

-- ─────────────────────────── Jobs ───────────────────────────
create table if not exists public.jobs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  portal        text not null,          -- linkedin | naukri | indeed | other
  external_id   text not null,          -- portal's own job id (or URL hash)
  url           text not null,
  title         text,
  company       text,
  location      text,
  posted_text   text,
  snippet       text,
  description   text,
  status        text not null default 'found',
  -- found → (details fetched) pending → scoring → tailored | stretch | skipped | error
  match_percent int,
  verdict       text,                   -- match | stretch | skip
  analysis      jsonb,                  -- matched skills, gaps, reasons
  tailored_path text,                   -- storage path in the "tailored" bucket
  tailored_edits jsonb,                 -- what Tailor changed and why
  error         text,
  applied       boolean not null default false,
  applied_at    timestamptz,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, portal, external_id)
);

create index if not exists jobs_user_status_idx on public.jobs (user_id, status);
create index if not exists jobs_user_created_idx on public.jobs (user_id, created_at desc);

-- ─────────────────────── Agent runs log ─────────────────────
create table if not exists public.runs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  agent       text not null,            -- hunter | tailor | applier | networker
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  stats       jsonb not null default '{}'::jsonb
);

-- ───────────────────── Row-level security ───────────────────
-- Users can only ever see and change their own rows. The server (secret key)
-- bypasses RLS for agent work.
alter table public.profiles         enable row level security;
alter table public.extension_tokens enable row level security;
alter table public.jobs             enable row level security;
alter table public.runs             enable row level security;

drop policy if exists "own profile read"   on public.profiles;
drop policy if exists "own profile update" on public.profiles;
create policy "own profile read"   on public.profiles for select using (auth.uid() = id);
create policy "own profile update" on public.profiles for update using (auth.uid() = id);

drop policy if exists "own tokens read" on public.extension_tokens;
create policy "own tokens read" on public.extension_tokens for select using (auth.uid() = user_id);

drop policy if exists "own jobs read"   on public.jobs;
drop policy if exists "own jobs update" on public.jobs;
create policy "own jobs read"   on public.jobs for select using (auth.uid() = user_id);
create policy "own jobs update" on public.jobs for update using (auth.uid() = user_id);

drop policy if exists "own runs read" on public.runs;
create policy "own runs read" on public.runs for select using (auth.uid() = user_id);

-- ──────────────────────── Storage buckets ───────────────────
-- Private buckets; files live under <user_id>/...
insert into storage.buckets (id, name, public) values ('cvs', 'cvs', false)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('tailored', 'tailored', false)
  on conflict (id) do nothing;

drop policy if exists "own cv files" on storage.objects;
create policy "own cv files" on storage.objects for select
  using (bucket_id in ('cvs','tailored') and (storage.foldername(name))[1] = auth.uid()::text);


-- ───────────── Migration 002 (achievements, wishlist, Coach) ─────────────

-- Certifications, awards, appreciations and recommendations
create table if not exists public.achievements (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null default 'certification'
              check (kind in ('certification','award','appreciation','recommendation','other')),
  title       text not null,
  issuer      text,             -- certifying body or company
  date_text   text,             -- free text: "Mar 2024", "2023"
  description text,
  url         text,             -- credential or post link
  source      text not null default 'manual' check (source in ('manual','linkedin')),
  status      text not null default 'confirmed' check (status in ('confirmed','suggested')),
  created_at  timestamptz not null default now()
);
create index if not exists achievements_user_idx on public.achievements (user_id, created_at desc);

-- Potential jobs: save to wishlist; track interview stage
alter table public.jobs add column if not exists wishlisted boolean not null default false;
alter table public.jobs add column if not exists stage text;          -- null | 'interview' | 'offer' | 'rejected'
alter table public.jobs add column if not exists interview_at text;   -- free text date the user enters

-- Coach: upskill plans and interview prep
create table if not exists public.coach_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  job_id     uuid references public.jobs(id) on delete set null,
  kind       text not null check (kind in ('interview','upskill')),
  title      text not null,
  input      jsonb not null default '{}'::jsonb,
  result     jsonb,
  sources    jsonb,              -- [{title, url}]
  search_html text,              -- Google search suggestions (must be shown with grounded results)
  error      text,
  created_at timestamptz not null default now()
);
create index if not exists coach_user_idx on public.coach_sessions (user_id, created_at desc);

alter table public.achievements   enable row level security;
alter table public.coach_sessions enable row level security;

drop policy if exists "own achievements read" on public.achievements;
create policy "own achievements read" on public.achievements for select using (auth.uid() = user_id);
drop policy if exists "own coach read" on public.coach_sessions;
create policy "own coach read" on public.coach_sessions for select using (auth.uid() = user_id);

-- ───────────── Migration 003 (Ask Coach chat, first-hand research) ─────────────
alter table public.coach_sessions add column if not exists messages jsonb not null default '[]'::jsonb;
alter table public.coach_sessions add column if not exists research jsonb;
alter table public.coach_sessions add column if not exists research_at timestamptz;

-- ───────────── Migration 004 (Applier, Networker) ─────────────
alter table public.jobs add column if not exists apply_pack jsonb;
alter table public.jobs add column if not exists apply_route text;               -- 'referral_first' | 'direct'
alter table public.jobs add column if not exists referral_wait_until timestamptz;  -- referral-first jobs: apply directly after this
alter table public.jobs add column if not exists apply_prepared_at timestamptz;

create table if not exists public.contacts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  job_id      uuid references public.jobs(id) on delete cascade,
  company     text,
  name        text not null,
  headline    text,
  profile_url text not null,
  location    text,
  degree      text,             -- '1st' | '2nd' | '3rd+'
  kind        text,             -- 'recruiter' | 'hiring_manager' | 'team_member' | 'alumni' | 'other'
  why         text,             -- why Networker picked this person
  note        text,             -- connection note (LinkedIn limit 300 chars)
  message     text,             -- follow-up referral ask, after they accept
  status      text not null default 'suggested'
              check (status in ('suggested','sent','replied','referred','skipped')),
  sent_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, job_id, profile_url)
);
create index if not exists contacts_user_idx on public.contacts (user_id, created_at desc);
create index if not exists contacts_sent_idx on public.contacts (user_id, sent_at);

alter table public.contacts enable row level security;
drop policy if exists "own contacts read" on public.contacts;
create policy "own contacts read" on public.contacts for select using (auth.uid() = user_id);

-- ───────────── Migration 005 (company careers) — table only; the company list loads from the app ─────────────
create table if not exists public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  industry    text,
  careers_url text,
  ats         text,              -- workday | greenhouse | lever | smartrecruiters | ashby | null (unsupported)
  ats_key     jsonb,
  status      text not null default 'new' check (status in ('new','resolved','unsupported','failed')),
  error       text,
  resolved_at timestamptz,
  checked_at  timestamptz,
  added_by    uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create unique index if not exists companies_name_key on public.companies (lower(name));
create index if not exists companies_industry_idx on public.companies (industry, name);
alter table public.companies enable row level security;  -- server-only table

-- ───────────── Migration 006 (shared company research) ─────────────
create table if not exists public.company_research (
  company_key   text primary key,
  company       text not null,
  data          jsonb not null,
  sources       jsonb,
  researched_at timestamptz not null default now()
);
alter table public.company_research enable row level security;
