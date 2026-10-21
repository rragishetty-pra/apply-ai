import { handle, HttpError, json, requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { parseCV } from "@/lib/cv";
import { extractInsights } from "@/lib/agents";

export const maxDuration = 60;

/** Upload a CV, read it, and suggest answers for the onboarding questions. */
export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "No file received.");
  if (file.size > 5 * 1024 * 1024) throw new HttpError(400, "Please keep the CV under 5 MB.");

  const data = new Uint8Array(await file.arrayBuffer());
  let parsed;
  try {
    parsed = await parseCV(file.name, data);
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : "Couldn't read that file.");
  }

  const db = supabaseAdmin();
  const path = `${user.id}/cv.${parsed.format}`;
  const up = await db.storage.from("cvs").upload(path, data, { upsert: true, contentType: file.type || undefined });
  if (up.error) throw new Error(up.error.message);

  const insights = await extractInsights(parsed.text).catch(() => null);

  const { error } = await db
    .from("profiles")
    .update({
      cv_path: path,
      cv_filename: file.name,
      cv_format: parsed.format,
      cv_text: parsed.text,
      cv_paragraphs: parsed.paragraphs,
      ...(insights?.full_name ? { full_name: insights.full_name } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);
  if (error) throw new Error(error.message);

  return json({ format: parsed.format, filename: file.name, insights });
});
