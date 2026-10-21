import { handle, HttpError, json, requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { cleanAchievement } from "@/lib/achievements";

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  const { data, error } = await supabaseAdmin()
    .from("achievements")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return json({ achievements: data || [] });
});

/** Add one achievement the user typed in. */
export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const a = cleanAchievement(await req.json());
  if (!a) throw new HttpError(400, "Give it a title, e.g. “AWS Certified Cloud Practitioner”.");
  const { data, error } = await supabaseAdmin()
    .from("achievements")
    .insert({ ...a, user_id: user.id, source: "manual", status: "confirmed" })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return json({ achievement: data });
});
