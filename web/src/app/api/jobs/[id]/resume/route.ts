import { handle, HttpError, json, requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

type Ctx = { params: Promise<{ id: string }> };

/** Short-lived download link for a tailored CV. */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const db = supabaseAdmin();

  const { data: job } = await db
    .from("jobs")
    .select("tailored_path, company")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!job?.tailored_path) throw new HttpError(404, "No tailored CV for this job yet.");

  const { data: profile } = await db.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const name = (profile?.full_name || "Resume").replace(/[^A-Za-z0-9]+/g, "_");
  const company = (job.company || "Job").replace(/[^A-Za-z0-9]+/g, "_").slice(0, 30);

  const { data, error } = await db.storage
    .from("tailored")
    .createSignedUrl(job.tailored_path, 120, { download: `${name}_${company}.docx` });
  if (error || !data) throw new Error(error?.message || "Couldn't create download link.");
  return json({ url: data.signedUrl });
});
