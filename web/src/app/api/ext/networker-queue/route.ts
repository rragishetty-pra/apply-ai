import { handle, json, preflight, requireExtension } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { capStatus } from "@/lib/networker";

export const OPTIONS = preflight;

/** Referral-first jobs that don't have anyone to ask yet (for the daily run). */
export const GET = handle(async (req) => {
  const user = await requireExtension(req);
  const db = supabaseAdmin();
  const { sentToday, cap } = await capStatus(user.id);
  if (sentToday >= cap) return json({ jobs: [], sentToday, cap });

  const { data: jobs } = await db
    .from("jobs")
    .select("id, title, company")
    .eq("user_id", user.id)
    .eq("status", "tailored")
    .eq("applied", false)
    .eq("apply_route", "referral_first")
    .order("match_percent", { ascending: false })
    .limit(20);
  const ids = (jobs || []).map((j) => j.id);
  const { data: have } = ids.length
    ? await db.from("contacts").select("job_id").eq("user_id", user.id).in("job_id", ids)
    : { data: [] as { job_id: string }[] };
  const covered = new Set((have || []).map((c) => c.job_id));
  return json({ jobs: (jobs || []).filter((j) => !covered.has(j.id)).slice(0, 3), sentToday, cap });
});
