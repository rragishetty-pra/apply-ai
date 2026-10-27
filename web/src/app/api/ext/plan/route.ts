import { handle, json, preflight, requireExtension } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { buildSearchPlan, lookbackDays } from "@/lib/portals";
import { mergePrefs } from "@/lib/types";

export const OPTIONS = preflight;

/** What Hunter should search in the user's Chrome today. */
export const GET = handle(async (req) => {
  const user = await requireExtension(req);
  const { data: profile } = await supabaseAdmin()
    .from("profiles")
    .select("full_name, email, prefs, cv_text, onboarded, last_hunter_at")
    .eq("id", user.id)
    .single();
  const prefs = mergePrefs(profile?.prefs);
  const ready = !!profile?.cv_text && prefs.target_roles.length > 0;
  return json({
    ready,
    reason: ready ? null : "Finish onboarding in Apply.ai (CV and target roles) first.",
    name: profile?.full_name || null,
    contact: { name: profile?.full_name || null, email: profile?.email || null, phone: prefs.phone || null },
    tasks: ready ? buildSearchPlan(prefs, lookbackDays(profile?.last_hunter_at)) : [],
    lookback_days: lookbackDays(profile?.last_hunter_at),
    max_jobs_per_run: prefs.max_jobs_per_run,
    daily_run_hour: prefs.daily_run_hour,
    portals: prefs.portals,
  });
});
