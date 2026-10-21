# Apply.ai — v0.1 (Hunter + Tailor)

A multi-user web app built from the Hunter → Tailor → Applier → Networker job pipeline.
Users sign in, upload their CV, answer a few questions, connect a Chrome extension, and
sign in to Naukri / LinkedIn / Indeed in their own Chrome. Hunter searches daily from
that Chrome; Tailor scores each job and tailors the user's own CV file for every good match.

```
apply-ai/
├── web/          Next.js app (pages + API) → deploy to Vercel (free)
├── extension/    Chrome extension (Hunter runs here, in the user's own browser)
└── supabase/     schema.sql → run once in Supabase (free): auth, database, file storage
```

## How the pieces fit

```
User's Chrome (extension)                    Apply.ai server (Vercel)              Supabase
───────────────────────────                  ────────────────────────              ────────
1. GET /api/ext/plan  ─────────────────────▶ builds searches from user's answers
2. opens search pages in a minimised window
   (user is already signed in) → reads job cards
3. POST /api/ext/jobs ─────────────────────▶ de-dupes, drops excluded employers,  ──▶ jobs
                                             1 AI call to drop unrelated titles
                       ◀──────────────────── "open these job pages next"
4. opens each job page → reads description
   POST /api/ext/detail ───────────────────▶ job → "pending"                     ──▶ jobs
5. POST /api/ext/tailor-next (loop) ───────▶ Tailor: 1 AI call per job =
                                             score + rewrites → safety checks →
                                             edits the user's own .docx           ──▶ storage
Dashboard ◀──────────────────────────────── jobs, scores, gaps, downloads
```

Passwords never leave the user's browser. The server only ever sees job listings and the CV.

## What works in this version

- Email sign-in (magic link), CV upload (.docx or .pdf), AI pre-fills the questions from the CV
- Questions: titles, skills, experience, notice period, cities, remote, abroad, excluded employers,
  match bar (default 70%), portals, daily run time, pages per run
- Chrome extension: pairs with the account, checks portal sign-ins, runs Hunter daily
  (or on demand), and an **“Add this job”** button for any other job site
- Tailor: match %, matched skills, gaps, “stretch” jobs with skills to build, and a tailored
  .docx per match that keeps the user's own layout. Safety checks refuse edits to the name,
  contact line, company/date lines, education, and over-long rewrites
- Dashboard: Tailored / Stretch / In progress / Applied / Skipped tabs, download CV,
  open job, mark applied, notes, re-run Tailor, “not interested”
- Applier and Networker show as “Coming next”

## Set it up (all free tiers)

### 1. Supabase (database, sign-in, file storage)
1. Create a project at supabase.com.
2. **SQL Editor → New query** → paste `supabase/schema.sql` → **Run**.
3. **Authentication → URL Configuration**: set *Site URL* to your app URL and add
   `http://localhost:3000/**` and `https://YOUR-APP.vercel.app/**` to *Redirect URLs*.
4. **Project Settings → API**: copy the project URL, the publishable (anon) key and the
   secret (service_role) key.

### 2. Gemini (the AI)
Google AI Studio → **Get API key**. Free, no card needed.

### 3. Run locally
```bash
cd web
cp .env.example .env.local     # fill in the values
npm install
npm run dev                    # http://localhost:3000
```

### 4. Load the extension
Chrome → `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → choose the
`extension` folder. Open the app, finish onboarding, click **Connect extension**.

### 5. Deploy (Vercel, free)
1. Push this folder to a GitHub repo, import it on vercel.com, set **Root Directory** to `web`.
2. Add the same environment variables (set `NEXT_PUBLIC_APP_URL` to the Vercel URL). Deploy.
3. Point the extension at it, then reload it in `chrome://extensions`:
   ```bash
   node extension/set-app-url.mjs https://YOUR-APP.vercel.app
   ```
4. Zip the `extension` folder and share it with beta users along with the app link.

## Things to know before inviting people

- **AI free tier is shared.** Gemini limits are per Google project, so every beta user draws
  from the same daily quota. Tailor uses 1 AI call per job (+1 per Hunter run), paces itself,
  and waits and retries when it hits the limit. Watch usage in AI Studio as users join.
- **Free-tier data use.** On Gemini's free tier Google may use prompts (CV text, job
  descriptions) to improve its products. Tell beta users, or enable billing on the Google
  project (paid tier) before handling CVs at scale. The AI is isolated in `web/src/lib/gemini.ts`
  so switching provider later is a one-file change.
- **Portal terms.** LinkedIn and Naukri don't allow automated access. The extension keeps
  activity human-paced (one tab, random pauses, capped pages per run, user's own session), but
  heavy use can still get an account limited. Keep “pages per run” modest.
- **Selectors will drift.** Portals change their page markup. If a portal starts returning
  0 jobs, update its selectors in `extension/scrapers.js` (each has fallbacks).
- **Free hosting limits.** Supabase pauses free projects after a week without activity;
  Vercel's Hobby plan is for non-commercial use — fine for a free beta.

## Added in v0.2

- **Achievements**: certifications, awards, appreciation and recommendations, added by hand or found by
  scanning the user's own LinkedIn (via the extension; the user confirms each one). Tailor may cite them.
- **Potential jobs + Wishlist**: near-miss jobs with the 1–3 skills that would close the gap, a
  "skills that unlock more jobs" rollup, and a wishlist.
- **Coach**: interview prep that searches public interview experiences (Glassdoor, AmbitionBox, Reddit,
  LeetCode, GeeksforGeeks…) through Gemini's Google Search grounding, and learning plans for skill gaps.
- Database: `supabase/migration-002-achievements-coach.sql` (already folded into `schema.sql`).

## Added in v0.3

- **Applier**: for every tailored job, checks (with web search) whether the company favours referrals,
  picks referral-first or apply-direct, and prepares an apply pack: cover note, safe answers with copy
  buttons, earliest joining date from the notice period, a "needs your answer" list it never auto-fills
  (CTC, gaps, visa…), and a checklist. Referral-first jobs wait 2 days, then say "Apply directly now".
- **Networker**: the extension searches LinkedIn people at the company; Networker picks the best few
  and drafts a connection note and referral ask in the user's voice. The user sends each one; the
  Network page tracks who was asked and days since. Daily cap (default 10).
- Daily run is now Hunter → Tailor → Applier → Networker.
- Database: `supabase/migration-004-applier-networker.sql`.

## Added in v0.4

- **More portals**: Foundit, Hirist (on by default), plus Shine, Instahyre, Cutshort, Glassdoor, Wellfound
  and iimjobs marked "Trial". New portals use a generic reader configured in `web/src/lib/portal-list.ts`
  (job-link pattern + sign-in pattern), so they can be tuned without changing the extension.
- **Company careers pages**: a shared list of 505 leading employers in India across 11 industries
  (`web/src/lib/company-seed.json`, loaded on first use). Each company's careers site is found once
  (Gemini + Google Search) and, if it runs on Workday, Greenhouse, Lever, SmartRecruiters or Ashby,
  searched through that system's public job feed on every Hunter run. Matching jobs go straight to Tailor.
  Users pick industries and can add companies in Settings.
- Database: `supabase/migration-005-company-careers.sql`.

## Cost controls (v0.4.1)

- Tailor scores every job first on Gemini Flash-Lite; only matches and near-misses (within 5 points of
  the match bar) get the full model's scoring and CV tailoring. Set `GEMINI_LITE_MODEL` to override.
- Default job pages per run: 25 (users can raise it in Settings, up to 80).
- Applier researches how each company hires once (Google Search) and shares it with every user for
  30 days (`company_research` table); per-job apply packs no longer use web search.

## Next phases

1. Run Hunter against live portals and tune `scrapers.js` from the results
2. **Applier** — per-job apply pack, referral-vs-direct advice, 2-day referral wait, flags for
   anything a recruiter might hesitate on
3. **Networker** — people at each company, referral drafts in the user's voice, 10/day cap
4. Weekly performance card, interview Coach, Naukri profile refresher
5. Chrome Web Store listing so users install with one click

## Tests

```bash
cd web
node --experimental-strip-types scripts/test-docx.ts input.docx output.docx
```
Checks that tailoring keeps formatting (bold labels, bullets, tables) and that the safety
checks reject edits to contact lines, dates and over-long rewrites.
