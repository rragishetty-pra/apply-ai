import { handle, json, preflight, requireExtension } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const OPTIONS = preflight;

export const POST = handle(async (req) => {
  const user = await requireExtension(req);
  const body = await req.json().catch(() => ({}));
  const db = supabaseAdmin();
  const now = new Date().toISOString();
  await db.from("runs").insert({
    user_id: user.id,
    agent: "hunter",
    started_at: body.started_at || now,
    finished_at: now,
    stats: body.stats || {},
  });
  await db.from("profiles").update({ last_hunter_at: now }).eq("id", user.id);
  return json({ ok: true });
});
