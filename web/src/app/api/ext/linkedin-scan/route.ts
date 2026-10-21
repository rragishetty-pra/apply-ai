import { handle, json, preflight, requireExtension } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { parseLinkedIn, type PostIn } from "@/lib/achievements";

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

  // Own posts, with certificate images (resized JPEGs from the extension).
  const posts: PostIn[] = (Array.isArray(body.posts) ? body.posts : []).slice(0, 30).map((p: Record<string, unknown>) => ({
    date: String(p.date || "").slice(0, 60),
    text: String(p.text || "").slice(0, 3000),
    url: /^https:\/\/www\.linkedin\.com\//.test(String(p.url)) ? String(p.url).slice(0, 400) : "",
    images: (Array.isArray(p.images) ? p.images : [])
      .filter((im: { mime?: string; data?: string }) => /^image\/(jpeg|png|webp)$/.test(String(im?.mime)) && typeof im?.data === "string" && im.data.length < 700_000)
      .slice(0, 2),
  }));

  const db = supabaseAdmin();
  const { data: existing } = await db.from("achievements").select("title, issuer").eq("user_id", user.id);
  const found = await parseLinkedIn(sections, existing || [], posts);

  if (found.length) {
    const { error } = await db
      .from("achievements")
      .insert(found.map((a) => ({ ...a, user_id: user.id, source: "linkedin", status: "suggested" })));
    if (error) throw new Error(error.message);
  }
  return json({ found: found.length });
});
