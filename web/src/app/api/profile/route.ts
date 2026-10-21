import { handle, HttpError, json, requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { mergePrefs, type Prefs } from "@/lib/types";

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  const db = supabaseAdmin();
  let { data } = await db
    .from("profiles")
    .select("id, email, full_name, cv_filename, cv_format, prefs, onboarded, last_hunter_at, portal_status")
    .eq("id", user.id)
    .maybeSingle();
  if (!data) {
    // In case the sign-up trigger wasn't installed
    await db.from("profiles").insert({ id: user.id, email: user.email });
    data = { id: user.id, email: user.email, full_name: null, cv_filename: null, cv_format: null, prefs: {}, onboarded: false, last_hunter_at: null, portal_status: {} };
  }
  return json({ profile: { ...data, prefs: mergePrefs(data.prefs) } });
});

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown) =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 20);
const num = (v: unknown) => (v === null || v === "" || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const body = await req.json();
  const p = body.prefs || {};
  const portals = list(p.portals).filter((x): x is Prefs["portals"][number] => ["linkedin", "naukri", "indeed"].includes(x));

  const phone = str(p.phone).replace(/[^\d+]/g, "");
  if (phone && !/^\+?\d{10,15}$/.test(phone)) throw new HttpError(400, "Enter a valid mobile number, e.g. +91 98765 43210.");

  const prefs: Prefs = mergePrefs({
    phone,
    target_roles: list(p.target_roles).slice(0, 5),
    key_skills: list(p.key_skills),
    experience_years: num(p.experience_years),
    locations: list(p.locations).slice(0, 5),
    remote_ok: !!p.remote_ok,
    abroad_ok: !!p.abroad_ok,
    abroad_countries: list(p.abroad_countries),
    exclude_companies: list(p.exclude_companies),
    notice_period_days: num(p.notice_period_days),
    job_types: list(p.job_types),
    match_threshold: Math.min(95, Math.max(40, num(p.match_threshold) ?? 70)),
    portals: portals.length ? portals : ["linkedin", "naukri", "indeed"],
    max_jobs_per_run: Math.min(80, Math.max(5, num(p.max_jobs_per_run) ?? 40)),
    daily_run_hour: num(p.daily_run_hour),
  });

  const update: Record<string, unknown> = { prefs, updated_at: new Date().toISOString() };
  if (str(body.full_name)) update.full_name = str(body.full_name);
  if (typeof body.onboarded === "boolean") update.onboarded = body.onboarded;

  const { error } = await supabaseAdmin().from("profiles").update(update).eq("id", user.id);
  if (error) throw new Error(error.message);
  return json({ ok: true, prefs });
});
