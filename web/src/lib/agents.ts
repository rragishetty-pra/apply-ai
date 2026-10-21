import "server-only";
import { askJSON } from "./gemini";
import type { Analysis, Prefs, Profile } from "./types";

/* ───────────────────────── Onboarding: read the CV ───────────────────────── */

export interface CVInsights {
  full_name: string;
  phone: string;
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
- phone: their mobile number exactly as written in the CV (empty string if none)
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
  job: { title: string | null; company: string | null; location: string | null; description: string | null },
  achievements = "none listed"
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
- matched: requirements the CV (or the candidate's achievements below) clearly meets.
- gaps: requirements it doesn't show, as short names of the skill, tool or experience (1–4 words each, e.g. "Snowflake", "Python scripting", "Team leadership").
- key_gaps: only for "stretch": the 1–3 gaps that would most likely get this person the job if they learned them.
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
   - You MAY mention items from the candidate's ACHIEVEMENTS list (their own certifications and awards) where
     they help for this job, e.g. in the summary or a skills/certifications line. Use their exact names.
   - Never edit the name, contact details, company names, job titles, dates or education lines.
   - Keep each rewrite within 80–125% of the original length, same tense and voice.
   - Write like a real experienced professional: plain, specific, no buzzword stuffing, no emojis.
   - If a skills line starts with a label (e.g. "Tools: "), keep that label exactly.
   - Each edit: {"i": paragraph number, "text": full new paragraph text, "why": short reason}.
   - note: one sentence on what you emphasised.

Return JSON: {match_percent, verdict, matched, gaps, key_gaps?, must_haves_met, summary, skip_reason?, edits?, note?}

JOB: ${job.title || ""} at ${job.company || ""} (${job.location || ""})
"""
${(job.description || "").slice(0, 12000)}
"""

CANDIDATE'S ACHIEVEMENTS (their own, confirmed):
${achievements}

CANDIDATE PREFERENCES: notice period ${prefs.notice_period_days ?? "not given"} days.

CV:
"""
${cvBlock.slice(0, 20000)}
"""`,
    { temperature: 0.3 }
  );
}

export { vetEdits } from "./vet";

/* ─────────────── Tailor step 1: quick score on the cheaper model ─────────────── */

/**
 * Every job gets this fast, cheap score first. Only jobs that look like a match (or are close)
 * go on to the full Tailor step, which re-scores on the main model and rewrites the CV.
 */
export async function quickScore(
  profile: Profile,
  prefs: Prefs,
  job: { title: string | null; company: string | null; location: string | null; description: string | null },
  achievements = "none listed"
): Promise<Analysis> {
  return askJSON<Analysis>(
    `Score how well this candidate fits the job. Be fair and realistic.
- match_percent: 0–100, how much of the job's real requirements the CV covers. A job can still be a match with
  a few must-haves missing (e.g. 3 of 5).
- verdict: "match" if match_percent >= ${prefs.match_threshold}; "stretch" if roughly ${Math.max(prefs.match_threshold - 20, 30)}–${prefs.match_threshold - 1}
  and reachable by learning a few skills; otherwise "skip".
- matched: requirements the CV or achievements clearly meet.
- gaps: requirements not shown, as short skill/tool/experience names (1–4 words each).
- key_gaps: for "stretch" only, the 1–3 gaps that would most likely get them the job.
- must_haves_met: like "3 of 5". summary: one plain sentence. skip_reason: only for "skip".
Return ONLY JSON: {match_percent, verdict, matched, gaps, key_gaps, must_haves_met, summary, skip_reason}

JOB: ${job.title || ""} at ${job.company || ""} (${job.location || ""})
"""
${(job.description || "").slice(0, 8000)}
"""
ACHIEVEMENTS:
${achievements}
CV:
"""
${(profile.cv_text || "").slice(0, 10000)}
"""`,
    { temperature: 0.1, tier: "lite", maxTokens: 2048 }
  );
}
