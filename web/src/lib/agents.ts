import "server-only";
import { askJSON } from "./gemini";
import type { Analysis, Prefs, Profile } from "./types";

/* ───────────────────────── Onboarding: read the CV ───────────────────────── */

export interface CVInsights {
  full_name: string;
  current_title: string;
  experience_years: number | null;
  target_roles: string[];
  key_skills: string[];
  locations: string[];
  current_employers: string[];
}

export async function extractInsights(cvText: string): Promise<CVInsights> {
  return askJSON<CVInsights>(
    `You read CVs for a job-search assistant. From the CV below, return JSON with:
- full_name: the person's name
- current_title: their latest job title
- experience_years: total years of professional experience as a number (null if unclear)
- target_roles: 3 job titles they would most plausibly search for next (same field, same or one level up)
- key_skills: the 8–12 most marketable skills/tools actually present in the CV
- locations: cities mentioned as their base (may be empty)
- current_employers: their current and most recent employers' names (so they can exclude them)
Only use facts in the CV. Do not invent.

CV:
"""
${cvText.slice(0, 20000)}
"""`,
    { temperature: 0.1 }
  );
}

/* ───────────────── Hunter helper: cheap title triage (1 call/run) ───────────────── */

export async function triageTitles(
  profile: Pick<Profile, "cv_text">,
  prefs: Prefs,
  jobs: { k: number; title: string; company: string; location: string }[]
): Promise<Set<number>> {
  if (jobs.length === 0) return new Set();
  const list = jobs.map((j) => `${j.k}. ${j.title} — ${j.company} — ${j.location}`).join("\n");
  const out = await askJSON<{ keep: number[] }>(
    `A job seeker targets: ${prefs.target_roles.join(", ") || "roles matching their CV"}.
Key skills: ${prefs.key_skills.join(", ")}. Experience: ${prefs.experience_years ?? "see CV"} years.
Below are job postings found on portals. Return JSON {"keep":[numbers]} listing every posting that is plausibly
relevant to this person's field and level (be inclusive; drop only clearly unrelated or far too junior/senior roles).

${list}`,
    { temperature: 0 }
  );
  return new Set((out.keep || []).map(Number));
}

/* ────────────────────────── Tailor: score + rewrite ────────────────────────── */

interface TailorAnswer extends Analysis {
  edits?: { i: number; text: string; why: string }[];
  note?: string;
}

export async function scoreAndTailor(
  profile: Profile,
  prefs: Prefs,
  job: { title: string | null; company: string | null; location: string | null; description: string | null }
): Promise<TailorAnswer> {
  const paragraphs = profile.cv_paragraphs;
  const cvBlock = paragraphs
    ? paragraphs.map((p) => `[${p.i}] ${p.text}`).join("\n")
    : profile.cv_text || "";

  return askJSON<TailorAnswer>(
    `You are "Tailor", a careful resume editor for a job seeker. Do two things.

1) SCORE how well the candidate fits this job.
- match_percent: 0–100, how much of the job's real requirements the CV covers.
- A job still counts as a match even if a few must-haves are missing (e.g. 3 of 5) — recruiters can decide.
- verdict: "match" if match_percent >= ${prefs.match_threshold}; "stretch" if it is within reach after learning
  a few skills (roughly ${Math.max(prefs.match_threshold - 20, 30)}–${prefs.match_threshold - 1}); otherwise "skip".
- matched: requirements the CV clearly meets. gaps: requirements it doesn't show.
- must_haves_met: like "3 of 5". summary: one plain sentence on the fit.
- skip_reason: only if verdict is "skip".

2) TAILOR, only if verdict is "match". ${
      paragraphs
        ? `The CV is given as numbered paragraphs [i]. Return "edits": up to 8 rewrites of existing paragraphs
   (the summary, the skills lines, and a few experience bullets most relevant to this job).`
        : `Return "edits" with i = -1 and the suggested new wording for the summary and up to 6 bullets.`
    }
   Rules — these are strict:
   - Never invent experience, tools, employers, titles, dates, numbers, degrees or certifications.
     You may reorder, re-emphasise and use the job's wording for things the CV already shows.
   - Never edit the name, contact details, company names, job titles, dates or education lines.
   - Keep each rewrite within 80–125% of the original length, same tense and voice.
   - Write like a real experienced professional: plain, specific, no buzzword stuffing, no emojis.
   - If a skills line starts with a label (e.g. "Tools: "), keep that label exactly.
   - Each edit: {"i": paragraph number, "text": full new paragraph text, "why": short reason}.
   - note: one sentence on what you emphasised.

Return JSON: {match_percent, verdict, matched, gaps, must_haves_met, summary, skip_reason?, edits?, note?}

JOB: ${job.title || ""} at ${job.company || ""} (${job.location || ""})
"""
${(job.description || "").slice(0, 12000)}
"""

CANDIDATE PREFERENCES: notice period ${prefs.notice_period_days ?? "not given"} days.

CV:
"""
${cvBlock.slice(0, 20000)}
"""`,
    { temperature: 0.3 }
  );
}

export { vetEdits } from "./vet";
