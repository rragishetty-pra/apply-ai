import { handle, json, requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  const { data, error } = await supabaseAdmin()
    .from("jobs")
    .select(
      "id, portal, url, title, company, location, posted_text, status, match_percent, verdict, analysis, tailored_path, tailored_edits, error, applied, applied_at, notes, wishlisted, stage, interview_at, apply_pack, apply_route, referral_wait_until, created_at"
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return json({ jobs: data || [] });
});
