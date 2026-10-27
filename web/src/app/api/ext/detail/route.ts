import { handle, HttpError, json, preflight, requireExtension } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const OPTIONS = preflight;

const s = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/** Full job description read from the job page in the user's Chrome. */
export const POST = handle(async (req) => {
  const user = await requireExtension(req);
  const body = await req.json();
  if (!body.id) throw new HttpError(400, "Missing job id");
  const description = s(body.description, 20000);
  const ok = description.length >= 200;
  const problem = s(body.problem, 40);

  const PROBLEMS: Record<string, string> = {
    bot_check: "The portal asked to confirm you're a person. Open it once in Chrome, then click Try again.",
    gone: "This job is no longer listed on the portal.",
    login_needed: "Sign in to this portal in Chrome, then click Try again.",
    no_description: "Couldn't read the job description on that page.",
  };
  const update: Record<string, unknown> = {
    description: description || null,
    // A job that's been taken down isn't a problem to fix: close it.
    status: ok ? "pending" : problem === "gone" ? "skipped" : "error",
    error: ok ? null : PROBLEMS[problem] || s(body.problem, 200) || PROBLEMS.no_description,
    updated_at: new Date().toISOString(),
  };
  if (!ok && problem === "gone") {
    update.verdict = "skip";
    update.analysis = { skip_reason: "No longer listed on the portal", matched: [], gaps: [], match_percent: 0, verdict: "skip", must_haves_met: "", summary: "" };
  }
  // Only take title/company/location from a real job page, never from an error or bot-check page.
  if (ok) for (const f of ["title", "company", "location"] as const) {
    const v = s(body[f], 300);
    if (v) update[f] = v;
  }

  const { error } = await supabaseAdmin().from("jobs").update(update).eq("id", body.id).eq("user_id", user.id);
  if (error) throw new Error(error.message);
  return json({ ok });
});
