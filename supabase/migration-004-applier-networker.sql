-- Apply.ai migration 004: Applier (apply packs, referral-first routing) and Networker (contacts). Safe to re-run.
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
