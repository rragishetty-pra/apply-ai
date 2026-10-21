import { handle, HttpError, json, preflight, requireExtension } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { achievementsForPrompt } from "@/lib/achievements";
import { buildInterviewPrep } from "@/lib/coach";
import { mergePrefs, type Analysis, type CoachSession } from "@/lib/types";

export const OPTIONS = preflight;
export const maxDuration = 60;

interface Section { site: string; url: string; items: string[]; login_needed?: boolean }

/**
 * The extension read interview reviews from Glassdoor / AmbitionBox in the user's own Chrome.
 * Rebuild the session's prep with those first-hand reviews.
 */
export const POST = handle(async (req) => {
  const user = await requireExtension(req);
  const body = await req.json();
  const sections: Section[] = (Array.isArray(body.sections) ? body.sections : [])
    .slice(0, 8)
    .map((x: Section) => ({
      site: String(x.site || "").slice(0, 40),
      url: /^https:\/\//.test(String(x.url)) ? String(x.url).slice(0, 500) : "",
      items: (Array.isArray(x.items) ? x.items : []).map((t) => String(t).slice(0, 2500)).filter(Boolean).slice(0, 40),
      login_needed: !!x.login_needed,
    }));

  const db = supabaseAdmin();
  const { data: s } = await db
    .from("coach_sessions")
    .select("*")
    .eq("id", String(body.session_id || ""))
    .eq("user_id", user.id)
    .maybeSingle<CoachSession>();
  if (!s || s.kind !== "interview") throw new HttpError(404, "That interview prep no longer exists.");

  const total = sections.reduce((n, x) => n + x.items.length, 0);
  const loginNeeded = sections.filter((x) => x.login_needed).map((x) => x.site);
  if (!total) return json({ found: 0, login_needed: loginNeeded });

  const firsthand = sections
    .filter((x) => x.items.length)
    .map((x) => `### From ${x.site} (${x.url})\n` + x.items.map((t, i) => `[${i + 1}] ${t}`).join("\n"))
    .join("\n\n");

  const [{ data: profile }, { data: ach }] = await Promise.all([
    db.from("profiles").select("cv_text, prefs").eq("id", user.id).single(),
    db.from("achievements").select("kind, title, issuer, date_text, description").eq("user_id", user.id).eq("status", "confirmed"),
  ]);
  let job: { description: string | null; analysis: Analysis | null } | null = null;
  if (s.job_id) {
    const { data } = await db.from("jobs").select("description, analysis").eq("id", s.job_id).eq("user_id", user.id).maybeSingle();
    job = data;
  }
  const input = s.input as { company: string; role: string; interview_at?: string | null; notes?: string | null };
  const out = await buildInterviewPrep(
    { cvText: profile?.cv_text || "", prefs: mergePrefs(profile?.prefs), achievements: achievementsForPrompt(ach || []) },
    {
      company: input.company,
      role: input.role,
      description: job?.description,
      gaps: job?.analysis?.gaps,
      interviewAt: input.interview_at,
      notes: input.notes,
    },
    firsthand
  );

  const pages = sections.filter((x) => x.items.length && x.url).map((x) => ({ title: `${x.site}: interview reviews`, url: x.url }));
  const seen = new Set(pages.map((x) => x.url));
  const sources = [...pages, ...out.sources.filter((x) => !seen.has(x.url))].slice(0, 40);

  const { error } = await db
    .from("coach_sessions")
    .update({
      result: out.data,
      sources,
      search_html: out.searchHtml || s.search_html,
      research: sections.filter((x) => x.items.length).map((x) => ({ site: x.site, url: x.url, count: x.items.length })),
      research_at: new Date().toISOString(),
    })
    .eq("id", s.id);
  if (error) throw new Error(error.message);
  return json({ found: total, login_needed: loginNeeded });
});
