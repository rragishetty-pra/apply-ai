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
