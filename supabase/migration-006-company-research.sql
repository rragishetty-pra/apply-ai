-- Apply.ai migration 006: shared company hiring research for Applier (cached 30 days). Safe to re-run.
create table if not exists public.company_research (
  company_key   text primary key,
  company       text not null,
  data          jsonb not null,
  sources       jsonb,
  researched_at timestamptz not null default now()
);
alter table public.company_research enable row level security;
