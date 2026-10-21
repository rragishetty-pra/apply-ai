import { handle, json, preflight, requireExtension } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { parseLinkedIn } from "@/lib/achievements";

export const OPTIONS = preflight;
export const maxDuration = 60;

/**
 * The extension read the user's own LinkedIn certifications, honours, recommendations and
 * recent posts. We turn that into achievement *suggestions* the user confirms in the app.
 */
export const POST = handle(async (req) => {
  const user = await requireExtension(req);
  const body = await req.json();
  const sections = (Array.isArray(body.sections) ? body.sections : [])
    .map((x: { section?: unknown; items?: unknown }) => ({
      section: String(x.section || "").slice(0, 60),
      items: (Array.isArray(x.items) ? x.items : []).map((t: unknown) => String(t)).filter(Boolean),
    }))
    .slice(0, 8);

  const db = supabaseAdmin();
  const { data: existing } = await db.from("achievements").select("title, issuer").eq("user_id", user.id);
  const found = await parseLinkedIn(sections, existing || []);

  if (found.length) {
    const { error } = await db
      .from("achievements")
      .insert(found.map((a) => ({ ...a, user_id: user.id, source: "linkedin", status: "suggested" })));
    if (error) throw new Error(error.message);
  }
  return json({ found: found.length });
});
