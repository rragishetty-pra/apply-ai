-- Apply.ai migration 002: achievements, potential-job wishlist, interview stage, Coach.
-- Safe to run more than once. Run in Supabase → SQL Editor → New query → Run.

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
