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
  if (typeof body.wishlisted === "boolean") update.wishlisted = body.wishlisted;
  if (body.stage === null || ["interview", "offer", "rejected", "not_interested"].includes(body.stage)) update.stage = body.stage;
  if (typeof body.interview_at === "string") update.interview_at = body.interview_at.slice(0, 60) || null;
  if (body.skip === true) Object.assign(update, { status: "skipped", stage: "not_interested" });
  if (body.reprepare === true) Object.assign(update, { apply_pack: null, apply_route: null, referral_wait_until: null });
  if (body.apply_now === true) update.referral_wait_until = new Date().toISOString();

  // Answers to Applier's "needs you" questions; optionally remembered for future applications.
  if (body.needs_answers && typeof body.needs_answers === "object") {
    const db = supabaseAdmin();
    const { data: cur } = await db.from("jobs").select("apply_pack").eq("id", id).eq("user_id", user.id).maybeSingle();
    const answers: Record<string, string> = {};
    for (const [k, v] of Object.entries(body.needs_answers as Record<string, unknown>)) {
      if (typeof v === "string") answers[k.slice(0, 40)] = v.trim().slice(0, 500);
    }
    if (cur?.apply_pack) {
      const pack = cur.apply_pack as { needs_you?: { key: string; answer?: string }[] };
      pack.needs_you = (pack.needs_you || []).map((n) => (n.key in answers ? { ...n, answer: answers[n.key] } : n));
      update.apply_pack = pack;
    }
    if (body.remember === true) {
      const { data: prof } = await db.from("profiles").select("prefs").eq("id", user.id).single();
      const prefs = prof?.prefs || {};
      const keep = Object.fromEntries(Object.entries(answers).filter(([, v]) => v));
      await db.from("profiles").update({ prefs: { ...prefs, standard_answers: { ...(prefs.standard_answers || {}), ...keep } } }).eq("id", user.id);
    }
  }
  if (body.retailor === true) {
    // Jobs skipped before their page was read go back to Hunter's reading queue first.
    const { data: cur } = await supabaseAdmin().from("jobs").select("description").eq("id", id).eq("user_id", user.id).maybeSingle();
    Object.assign(update, { status: cur?.description ? "pending" : "found", error: null, stage: null });
  }

  const { data, error } = await supabaseAdmin()
    .from("jobs")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, applied, applied_at, notes, status, wishlisted, stage, interview_at, apply_pack, apply_route, referral_wait_until")
    .single();
  if (error) throw new Error(error.message);
  return json({ job: data });
});
