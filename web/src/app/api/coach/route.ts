import { handle, HttpError, json, requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { achievementsForPrompt } from "@/lib/achievements";
import { buildInterviewPrep, buildUpskillPlan } from "@/lib/coach";
import { AIServiceError } from "@/lib/gemini";
import { mergePrefs, type Analysis } from "@/lib/types";

export const maxDuration = 60;

const s = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  const { data, error } = await supabaseAdmin()
    .from("coach_sessions")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) throw new Error(error.message);
  return json({ sessions: data || [] });
});

/** Start a Coach session: interview prep for a job, or an upskill plan. Runs now and returns the result. */
export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const body = await req.json();
  const kind = body.kind === "upskill" ? "upskill" : "interview";
  const db = supabaseAdmin();

  const [{ data: profile }, { data: ach }] = await Promise.all([
    db.from("profiles").select("cv_text, prefs").eq("id", user.id).single(),
    db.from("achievements").select("kind, title, issuer, date_text, description").eq("user_id", user.id).eq("status", "confirmed"),
  ]);
  if (!profile?.cv_text) throw new HttpError(400, "Upload your CV first, so Coach can tailor the advice to you.");
  const person = { cvText: profile.cv_text, prefs: mergePrefs(profile.prefs), achievements: achievementsForPrompt(ach || []) };

  let job: { id: string; title: string | null; company: string | null; description: string | null; analysis: Analysis | null; interview_at: string | null } | null = null;
  if (body.job_id) {
    const { data } = await db
      .from("jobs")
      .select("id, title, company, description, analysis, interview_at")
      .eq("id", body.job_id)
      .eq("user_id", user.id)
      .maybeSingle();
    job = data;
    if (!job) throw new HttpError(404, "That job isn't in your pipeline any more.");
  }

  let title: string;
  let input: Record<string, unknown>;
  let run: () => ReturnType<typeof buildInterviewPrep> | ReturnType<typeof buildUpskillPlan>;

  if (kind === "interview") {
    const company = s(body.company, 120) || job?.company || "";
    const role = s(body.role, 160) || job?.title || "";
    if (!company || !role) throw new HttpError(400, "Tell Coach the company and the role.");
    const interviewAt = s(body.interview_at, 60) || job?.interview_at || null;
    const notes = s(body.notes, 1500) || null;
    title = `${role} at ${company}`;
    input = { company, role, interview_at: interviewAt, notes };
    if (job && interviewAt !== job.interview_at) await db.from("jobs").update({ interview_at: interviewAt, stage: "interview" }).eq("id", job.id);
    run = () =>
      buildInterviewPrep(person, {
        company,
        role,
        description: job?.description,
        gaps: job?.analysis?.gaps,
        interviewAt,
        notes,
      });
  } else {
    let skills: string[] = (Array.isArray(body.skills) ? body.skills : s(body.skills, 300).split(","))
      .map((x: unknown) => String(x).trim())
      .filter(Boolean)
      .slice(0, 4);
    const role = s(body.role, 160) || job?.title || person.prefs.target_roles[0] || null;
    let jobsContext = "";
    if (job) {
      if (!skills.length) skills = job.analysis?.key_gaps?.length ? job.analysis.key_gaps : (job.analysis?.gaps || []).slice(0, 3);
      jobsContext = `- ${job.title} at ${job.company}: needs ${(job.analysis?.gaps || []).join(", ")}`;
    } else {
      // Use the user's potential jobs as context for which skills matter.
      const { data: stretch } = await db
        .from("jobs")
        .select("title, company, analysis")
        .eq("user_id", user.id)
        .eq("status", "stretch")
        .order("wishlisted", { ascending: false })
        .limit(12);
      jobsContext = (stretch || [])
        .map((j) => `- ${j.title} at ${j.company}: needs ${((j.analysis as Analysis | null)?.gaps || []).slice(0, 6).join(", ")}`)
        .join("\n");
    }
    if (!skills.length && !role) throw new HttpError(400, "Tell Coach which skill or role you want to work towards.");
    title = skills.length ? `Learn ${skills.join(", ")}` : `Grow into ${role}`;
    input = { skills, role, job_id: job?.id || null };
    run = () => buildUpskillPlan(person, { skills, role, jobsContext });
  }

  try {
    const out = await run();
    const { data, error } = await db
      .from("coach_sessions")
      .insert({
        user_id: user.id,
        job_id: job?.id || null,
        kind,
        title,
        input,
        result: out.data,
        sources: out.sources,
        search_html: out.searchHtml,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return json({ session: data });
  } catch (e) {
    if (e instanceof AIServiceError) throw e;
    throw new HttpError(502, "Coach couldn't finish this one. Try again in a minute.");
  }
});
