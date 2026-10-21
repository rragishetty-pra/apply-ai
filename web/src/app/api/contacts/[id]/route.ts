import { handle, HttpError, json, requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { capStatus } from "@/lib/networker";

type Ctx = { params: Promise<{ id: string }> };
const STATUSES = ["suggested", "sent", "replied", "referred", "skipped"];

/** Track a referral ask the user sent themselves; edit the drafts. */
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const body = await req.json();
  const db = supabaseAdmin();
  const { data: cur } = await db.from("contacts").select("status, sent_at, job_id").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!cur) throw new HttpError(404, "That contact no longer exists.");

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.note === "string") update.note = body.note.slice(0, 300);
  if (typeof body.message === "string") update.message = body.message.slice(0, 1500);
  if (STATUSES.includes(body.status)) {
    if (body.status === "sent" && !cur.sent_at) {
      const { sentToday, cap } = await capStatus(user.id);
      if (sentToday >= cap) {
        throw new HttpError(400, `You've reached today's limit of ${cap} new people. Pick up again tomorrow; it keeps your LinkedIn account safe.`);
      }
      update.sent_at = new Date().toISOString();
    }
    if (body.status === "suggested") update.sent_at = null;
    update.status = body.status;
  }
  const { data, error } = await db.from("contacts").update(update).eq("id", id).eq("user_id", user.id).select("*").single();
  if (error) throw new Error(error.message);
  return json({ contact: data });
});

export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  await supabaseAdmin().from("contacts").delete().eq("id", id).eq("user_id", user.id);
  return json({ ok: true });
});
