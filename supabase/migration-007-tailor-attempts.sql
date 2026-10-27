-- Tailor retries: a job that keeps timing out is set aside instead of blocking the queue.
alter table public.jobs add column if not exists tailor_attempts int not null default 0;
