import { handle, json, requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const { error } = await supabaseAdmin().from("coach_sessions").delete().eq("id", id).eq("user_id", user.id);
  if (error) throw new Error(error.message);
  return json({ ok: true });
});
