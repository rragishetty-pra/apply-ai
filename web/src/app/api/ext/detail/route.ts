import { handle, HttpError, json, preflight, requireExtension } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const OPTIONS = preflight;

const s = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/** Full job description read from the job page in the user's Chrome. */
export const POST = handle(async (req) => {
  const user = await requireExtension(req);
  const body = await req.json();
  if (!body.id) throw new HttpError(400, "Missing job id");
  const description = s(body.description, 20000);
  const ok = description.length >= 200;

  const update: Record<string, unknown> = {
    description: description || null,
    status: ok ? "pending" : "error",
    error: ok ? null : s(body.problem, 200) || "Couldn't read the job description on that page.",
    updated_at: new Date().toISOString(),
  };
  for (const f of ["title", "company", "location"] as const) {
    const v = s(body[f], 300);
    if (v) update[f] = v;
  }

  const { error } = await supabaseAdmin().from("jobs").update(update).eq("id", body.id).eq("user_id", user.id);
  if (error) throw new Error(error.message);
  return json({ ok });
});
