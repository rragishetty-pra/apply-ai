import { handle, HttpError, json, requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { cleanAchievement } from "@/lib/achievements";

type Ctx = { params: Promise<{ id: string }> };

/** Edit, or confirm a LinkedIn suggestion. */
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const body = await req.json();
  const update: Record<string, unknown> = {};
  if (body.title !== undefined) {
    const a = cleanAchievement(body);
    if (!a) throw new HttpError(400, "Title can't be empty.");
    Object.assign(update, a);
  }
  if (body.status === "confirmed") update.status = "confirmed";
  const { data, error } = await supabaseAdmin()
    .from("achievements")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return json({ achievement: data });
});

export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const { error } = await supabaseAdmin().from("achievements").delete().eq("id", id).eq("user_id", user.id);
  if (error) throw new Error(error.message);
  return json({ ok: true });
});
