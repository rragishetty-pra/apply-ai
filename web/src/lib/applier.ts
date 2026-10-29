import "server-only";
import { supabaseAdmin } from "./supabase-admin";
import { askGroundedJSON, askJSON, AIServiceError } from "./gemini";
import { achievementsForPrompt } from "./achievements";
import { mergePrefs, type ApplyPack, type Prefs, type Profile } from "./types";
import { finalizePack } from "./applier-pack";

export const REFERRAL_WAIT_DAYS = 2;
const RESEARCH_TTL_DAYS = 30;

/** "Deloitte Touche Tohmatsu India LLP" and "Deloitte (USI)" → "deloitte touche tohmatsu" / "deloitte". */
export function companyKey(name: string) {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !["pvt", "private", "ltd", "limited", "inc", "llp", "llc", "corp", "corporation", "co", "india", "the", "group", "plc"].includes(w))
    .join(" ")
    .replace(/(^| )and$/, "")
    .trim()
    .slice(0, 80);
}

interface CompanyResearch {
  referral_culture: "strong" | "some" | "weak" | "unknown";
  referral_programme: boolean;
  usual_route: "referral_first" | "direct";
  reason: string;
  notes: string[];
}

/**
 * How a company hires — researched with web search once, then shared by every user for 30 days.
 * This is the only part of Applier that needs Google Search.
 */
type Research = { data: CompanyResearch; sources: { title: string; url: string }[] };

/** Research already on file for this company (shared by all users), or null. */
export async function cachedCompanyResearch(company: string): Promise<Research | null> {
  const key = companyKey(company);
  if (!key) return null;
  const { data: cached } = await supabaseAdmin().from("company_research").select("data, sources, researched_at").eq("company_key", key).maybeSingle();
  if (cached && Date.now() - new Date(cached.researched_at).getTime() < RESEARCH_TTL_DAYS * 86400_000) {
    return { data: cached.data as CompanyResearch, sources: (cached.sources as { title: string; url: string }[]) || [] };
  }
  return null;
}

/** When research fails for a reason other than AI limits, note "unknown" for a day so we don't retry every time. */
async function noteResearchUnknown(company: string) {
  const key = companyKey(company);
  if (!key) return;
  const data: CompanyResearch = { referral_culture: "unknown", referral_programme: false, usual_route: "direct", reason: "", notes: [] };
  const researched_at = new Date(Date.now() - (RESEARCH_TTL_DAYS - 1) * 86400_000).toISOString();
  await supabaseAdmin().from("company_research").upsert({ company_key: key, company, data, sources: [], researched_at });
}

export async function getCompanyResearch(company: string): Promise<Research | null> {
  const key = companyKey(company);
  if (!key) return null;
  const db = supabaseAdmin();
  const cached = await cachedCompanyResearch(company);
  if (cached) return cached;
  const out = await askGroundedJSON<CompanyResearch>(
    `Research how ${company} hires in India, using Google Search.
Does it run an employee referral programme? Do candidates on Glassdoor, AmbitionBox or Reddit say referrals matter
there, or that cold applications get ignored? Is it a large company where applications pile up, or a staffing /
consulting firm or startup where applying directly works fine?
Return ONLY JSON: {"referral_culture": "strong" | "some" | "weak" | "unknown", "referral_programme": true|false,
"usual_route": "referral_first" | "direct", "reason": "one plain sentence", "notes": ["1–3 short facts you found"]}`,
    { temperature: 0.2 }
  );
  const data: CompanyResearch = {
    referral_culture: ["strong", "some", "weak"].includes(out.data.referral_culture) ? out.data.referral_culture : "unknown",
    referral_programme: !!out.data.referral_programme,
    usual_route: out.data.usual_route === "referral_first" ? "referral_first" : "direct",
    reason: String(out.data.reason || "").slice(0, 400),
    notes: (Array.isArray(out.data.notes) ? out.data.notes : []).map((x) => String(x).slice(0, 200)).slice(0, 3),
  };
  if (!out.grounded) {
    // Google Search wasn't available: this is the AI's general knowledge, so say so and re-check in a week.
    data.notes = ["Not checked with Google Search (general knowledge only)", ...data.notes].slice(0, 3);
  }
  const researched_at = new Date(Date.now() - (out.grounded ? 0 : (RESEARCH_TTL_DAYS - 7) * 86400_000)).toISOString();
  await db.from("company_research").upsert({ company_key: key, company, data, sources: out.sources.slice(0, 10), researched_at });
  return { data, sources: out.sources };
}

/**
 * Applier: for one tailored job, decide referral-first vs apply-direct (checking whether the
 * company favours referrals), and prepare an apply pack. It never submits anything and never
 * auto-fills answers that could make a recruiter hesitate — those go to "needs you".
 */
export async function buildApplyPack(
  profile: Pick<Profile, "cv_text" | "full_name" | "email">,
  prefs: Prefs,
  achievements: string,
  job: { title: string | null; company: string | null; location: string | null; url: string; description: string | null; match_percent: number | null }
): Promise<ApplyPack> {
  const today = new Date();
  const notice = prefs.notice_period_days ?? null;
  const joining = notice !== null ? new Date(today.getTime() + notice * 86400_000) : null;
  const joiningText = joining ? joining.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";

  const known = Object.entries(prefs.standard_answers || {})
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  // Research runs in its own request (see applierNext); here we only read what's on file.
  const research = job.company ? await cachedCompanyResearch(job.company).catch(() => null) : null;

  const pack = await askJSON<Partial<ApplyPack>>(
    `You are "Applier", preparing a job application for a candidate who will submit it themselves.

JOB: ${job.title} at ${job.company} (${job.location || "location not given"}). Match: ${job.match_percent ?? "?"}%.
JOB LINK: ${job.url}

1) DECIDE THE ROUTE using what we know about how ${job.company} hires:
${research ? `- Referral culture: ${research.data.referral_culture}; referral programme: ${research.data.referral_programme ? "yes" : "no/unknown"}
- Usually: ${research.data.usual_route === "referral_first" ? "referrals help" : "applying directly works"} (${research.data.reason})
- Notes: ${research.data.notes.join("; ") || "none"}` : "- No research available; judge from the company's size and type."}
Adjust for THIS posting (e.g. a staffing agency or "easy apply" listing → direct; a very senior or popular role at a big firm → referral first). Choose:
- "referral_first": try for a referral first (the candidate waits ${REFERRAL_WAIT_DAYS} days for one, then applies directly anyway)
- "direct": apply now
Give route_reason in one plain sentence and company_notes as 1–3 short facts (from the research above; don't invent).

2) WRITE the pack:
- cover_note: 90–140 words in the candidate's own voice: plain, specific, confident, no clichés, no "I am writing to".
  Mention one or two concrete things from the CV that match this job. Sign off with their first name.
- answers: answers that are SAFE to paste into application forms, from the facts below only
  (e.g. total experience, current location, earliest joining date, willing to relocate, email, phone, LinkedIn if in CV).
- needs_you: questions this application will likely ask that must NOT be auto-filled — anything that could make a
  recruiter hesitate or that only the candidate can decide: current CTC, expected CTC, reason for leaving, career
  gaps, visa/work authorisation, serving notice / buyout, relocation cost, and anything in the job description
  that the candidate may not meet (e.g. "immediate joiners only" vs their notice, a required degree, on-site only,
  years of experience above theirs). Each: {"key": "short_snake_case_id", "question": "...", "why": "why it matters here"}.
  Use these keys when relevant: current_ctc, expected_ctc, reason_for_leaving, career_gap, work_authorisation, notice_buyout.
- checklist: 4–7 short steps to apply well for THIS job (e.g. which CV file to upload, what to double-check).

Return ONLY JSON: {route, route_reason, company_notes, cover_note, answers:[{question,answer}], needs_you:[{key,question,why}], checklist}

FACTS ABOUT THE CANDIDATE:
- Name: ${profile.full_name || "see CV"}
- Email: ${profile.email || "not given"}
- Mobile: ${prefs.phone || "not given"}
- Total experience: ${prefs.experience_years ?? "see CV"} years
- Preferred locations: ${prefs.locations.join(", ") || "not given"}; remote OK: ${prefs.remote_ok ? "yes" : "no"}; relocation abroad: ${prefs.abroad_ok ? "yes" : "no"}
- Notice period: ${notice ?? "not given"} days${joiningText ? ` → earliest joining date if they apply today: ${joiningText}` : ""}
- Answers they gave before (reuse, don't ask again):
${known || "  none"}

ACHIEVEMENTS:
${achievements}

JOB DESCRIPTION:
"""
${(job.description || "").slice(0, 8000)}
"""

CV:
"""
${(profile.cv_text || "").slice(0, 12000)}
"""`,
    { temperature: 0.4 }
  );


  return finalizePack(pack, {
    jobUrl: job.url,
    company: job.company,
    joiningText,
    standardAnswers: prefs.standard_answers || {},
    sources: research?.sources || [],
  });
}

export interface ApplierStep {
  done: boolean;
  remaining: number;
  step?: "research" | "pack" | "failed";
  job?: { id: string; title: string | null; company: string | null; route?: string };
  rate_limited?: boolean;
  daily_limit?: boolean;
  message?: string;
}

/**
 * Prepare apply packs ONE step at a time, so no request gets near the server's 60s limit:
 *  1. if the company hasn't been researched yet → research it (Google Search), and stop there;
 *  2. otherwise → write the pack for the job.
 * A job whose pack fails is set aside with a message (the per-job button retries it), so one bad
 * job never blocks the rest.
 */
export async function applierNext(userId: string, jobId?: string): Promise<ApplierStep> {
  const db = supabaseAdmin();
  const count = async () => {
    const { count } = await db
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "tailored")
      .eq("applied", false)
      .is("apply_pack", null)
      .is("error", null);
    return count || 0;
  };

  if (jobId) await db.from("jobs").update({ error: null }).eq("id", jobId).eq("user_id", userId).eq("status", "tailored");

  let q = db
    .from("jobs")
    .select("id, title, company, location, url, description, match_percent")
    .eq("user_id", userId)
    .eq("status", "tailored");
  q = jobId ? q.eq("id", jobId) : q.eq("applied", false).is("apply_pack", null).is("error", null);
  const { data: job } = await q.order("match_percent", { ascending: false }).limit(1).maybeSingle();
  if (!job) return { done: true, remaining: 0 };
  const jobInfo = { id: job.id, title: job.title, company: job.company };

  try {
    // Step 1: company research, in its own request (cached for everyone for 30 days).
    if (job.company && !(await cachedCompanyResearch(job.company))) {
      try {
        await getCompanyResearch(job.company);
      } catch (e) {
        if (e instanceof AIServiceError && (e.status === 429 || e.status === 503)) throw e;
        await noteResearchUnknown(job.company); // search unavailable → write the pack without it
      }
      return { done: false, remaining: await count(), step: "research", job: jobInfo };
    }

    // Step 2: the pack.
    const [{ data: profile }, { data: ach }] = await Promise.all([
      db.from("profiles").select("cv_text, full_name, email, prefs").eq("id", userId).single(),
      db.from("achievements").select("kind, title, issuer, date_text, description").eq("user_id", userId).eq("status", "confirmed"),
    ]);
    const prefs = mergePrefs(profile?.prefs);
    const pack = await buildApplyPack(profile || { cv_text: "", full_name: null, email: null }, prefs, achievementsForPrompt(ach || []), job);
    const now = Date.now();
    await db
      .from("jobs")
      .update({
        apply_pack: pack,
        apply_route: pack.route,
        referral_wait_until: pack.route === "referral_first" ? new Date(now + REFERRAL_WAIT_DAYS * 86400_000).toISOString() : null,
        apply_prepared_at: new Date(now).toISOString(),
        error: null,
        updated_at: new Date(now).toISOString(),
      })
      .eq("id", job.id);
    return { done: false, remaining: await count(), step: "pack", job: { ...jobInfo, route: pack.route } };
  } catch (e) {
    if (e instanceof AIServiceError && (e.status === 429 || e.status === 503)) {
      // Not the job's fault: leave it queued and tell the caller why.
      return { done: false, remaining: await count(), rate_limited: true, daily_limit: e.daily, message: e.message, job: jobInfo };
    }
    const message =
      e instanceof AIServiceError && e.status === 504
        ? "The AI took too long writing this apply pack. Click Prepare apply pack to try again."
        : `Couldn't prepare the apply pack: ${(e as Error).message || e}`.slice(0, 400);
    await db.from("jobs").update({ error: message }).eq("id", job.id);
    return { done: false, remaining: await count(), step: "failed", message, job: jobInfo };
  }
}
