import { createHash } from "crypto";
import { handle, HttpError, json, preflight, requireExtension } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const OPTIONS = preflight;

const s = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/** "Add this job" from any job page — covers portals Hunter doesn't search. */
export const POST = handle(async (req) => {
  const user = await requireExtension(req);
  const body = await req.json();
  const url = s(body.url, 1000);
  const description = s(body.description, 20000);
  if (!url) throw new HttpError(400, "Missing page URL");
  if (description.length < 200) throw new HttpError(400, "Couldn't find a job description on this page. Open the job's own page and try again.");

  const portal = s(body.portal, 20) || "other";
  const external_id = s(body.external_id, 200) || createHash("sha1").update(url.split("#")[0]).digest("hex").slice(0, 20);

  const { data, error } = await supabaseAdmin()
    .from("jobs")
    .upsert(
      {
        user_id: user.id,
        portal,
        external_id,
        url,
        title: s(body.title, 300) || "Untitled job",
        company: s(body.company, 300) || null,
        location: s(body.location, 300) || null,
        description,
        status: "pending",
        error: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,portal,external_id" }
    )
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return json({ id: data.id });
});
