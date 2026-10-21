import { handle, json, preflight, requireExtension } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const OPTIONS = preflight;

/** Which portals the user is signed in to in their Chrome (checked by the extension). */
export const POST = handle(async (req) => {
  const user = await requireExtension(req);
  const body = await req.json();
  const status: Record<string, string> = {};
  for (const [k, v] of Object.entries(body.status || {})) {
    if (["linkedin", "naukri", "indeed"].includes(k) && typeof v === "string") status[k] = v.slice(0, 20);
  }
  const db = supabaseAdmin();
  const { data } = await db.from("profiles").select("portal_status").eq("id", user.id).single();
  const merged = { ...(data?.portal_status || {}), ...status, checked_at: new Date().toISOString() };
  await db.from("profiles").update({ portal_status: merged }).eq("id", user.id);
  return json({ portal_status: merged });
});
