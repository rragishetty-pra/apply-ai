# Apply.ai backlog

Items are roughly in priority order within each section. Move an item to "Done" with the date when it ships.

## Waiting on data

### Test lower "thinking" for Applier (cost vs quality)
- **Why:** Gemini's hidden thinking tokens are billed at the output rate. Applier's company research is now shared
  and cached, so the per-job pack is mostly structured writing — it may hold up with lower thinking.
- **Not for Tailor:** keep Tailor on full thinking. It writes the CVs users judge us by, and since the two-step
  scoring change it only runs on matches and near-misses.
- **When:** after a few beta users have real tailored jobs in the system.
- **How:** run the same ~20 real jobs through Applier twice (current setting vs low thinking) and compare:
  1. Referral-first vs apply-direct decisions — do they agree?
  2. "Needs your answer" items — does low thinking miss any (e.g. "immediate joiners only" vs a 45-day notice)?
  3. Cover notes side by side — any drop in specificity or tone?
  4. Actual cost per pack (from Gemini usage metadata).
- **Decision:** switch only if decisions agree, no needs-you items are missed, and cover notes are comparable.

## Next up
- Clean-up: old Indeed rows titled "Additional Verification Required" / "We can't find this page" came from decoy links.
- Hirist: read the company name from the job page (the results card shows a category instead).
- Tune the "Trial" portals (Shine, Instahyre, Cutshort, Glassdoor, Wellfound, iimjobs) after the first live runs.
- Tune Hunter / Networker / Coach page readers against live LinkedIn, Naukri, Glassdoor and AmbitionBox pages.
- Careers-page search: support SuccessFactors, Oracle Recruiting Cloud and Taleo (used by many Indian IT firms).
- Storage housekeeping: delete tailored CVs older than 30 days (Supabase free plan has 1 GB of file storage).
- Publish the extension on the Chrome Web Store (unlisted) for one-click install and auto-updates.

## Later
- "Continue with Google" sign-in (no emails needed).
- Weekly performance card on the dashboard.
- Naukri profile refresher to keep profiles ranking high.
- Mock-interview scoring history in Coach.

## Done
- 2026-10-26 — Live run fixes: Tailor split into two short steps with a 3-try limit (one slow job no longer blocks the queue); Indeed decoy links skipped and descriptions read from the results pane (no bot checks); LinkedIn's new job search and job pages; Hirist's real search address; bot-check and expired pages no longer overwrite job titles.
- 2026-10-23 — Hunter: foundit reader (its cards have no links) with a 30-day window; Instahyre via its public search (no sign-in); searches look back to the last run (30 days on the first) instead of a fixed 24 hours; late sign-in redirects detected.
- 2026-10-22 — LinkedIn scan: certificate images found even before they load, exact post dates, 'paste a post link' for posts LinkedIn hides from activity.
- 2026-10-22 — LinkedIn scan reads your own posts (scrolling back years) and the certificate images in them, not just profile sections.
- 2026-10-22 — LinkedIn achievements scan fixed (read whole entries, not sub-items), made faster (pages in parallel, time caps) and shows live progress.
- 2026-10-21 — Dashboard rebuilt as an application tracker (one status + next step per job); sign-in list and check cover every selected portal.
- 2026-10-21 — Cost controls: Flash-Lite first-pass scoring, 25 pages per run by default, shared company research for Applier.
