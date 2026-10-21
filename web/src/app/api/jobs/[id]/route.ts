import { handle, json, requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

type Ctx = { params: Promise<{ id: string }> };

/** Update what the user controls on a job: applied, notes, or re-queue for Tailor. */
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const body = await req.json();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof body.applied === "boolean") {
    update.applied = body.applied;
    update.applied_at = body.applied ? new Date().toISOString() : null;
  }
  if (typeof body.notes === "string") update.notes = body.notes.slice(0, 2000);
  if (body.skip === true) update.status = "skipped";
  if (body.retailor === true) {
    // Jobs skipped before their page was read go back to Hunter's reading queue first.
    const { data: cur } = await supabaseAdmin().from("jobs").select("description").eq("id", id).eq("user_id", user.id).maybeSingle();
    Object.assign(update, { status: cur?.description ? "pending" : "found", error: null });
  }

  const { data, error } = await supabaseAdmin()
    .from("jobs")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, applied, applied_at, notes, status")
    .single();
  if (error) throw new Error(error.message);
  return json({ job: data });
});
