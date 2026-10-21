-- Apply.ai migration 003: Ask Coach chat + first-hand interview research. Safe to re-run.
alter table public.coach_sessions add column if not exists messages jsonb not null default '[]'::jsonb;
alter table public.coach_sessions add column if not exists research jsonb;
alter table public.coach_sessions add column if not exists research_at timestamptz;
