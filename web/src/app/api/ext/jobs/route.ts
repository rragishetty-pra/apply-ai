import { handle, json, preflight, requireExtension } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { triageTitles } from "@/lib/agents";
import { mergePrefs } from "@/lib/types";

export const OPTIONS = preflight;
export const maxDuration = 60;

interface Listed {
  portal: string;
  external_id: string;
  url: string;
  title?: string;
  company?: string;
  location?: string;
  posted_text?: string;
  snippet?: string;
}

const s = (v: unknown, n = 300) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/**
 * Hunter sends the job cards it saw on search pages. We keep new ones, drop
 * excluded employers and clearly unrelated titles, and reply with the job pages
 * whose full description the extension should open next.
 */
export const POST = handle(async (req) => {
  const user = await requireExtension(req);
  const db = supabaseAdmin();
  const body = await req.json();

  const incoming: Listed[] = (Array.isArray(body.jobs) ? body.jobs : [])
    .map((j: Listed) => ({
      portal: s(j.portal, 20) || "other",
      external_id: s(j.external_id, 200),
      url: s(j.url, 1000),
      title: s(j.title),
      company: s(j.company),
      location: s(j.location),
      posted_text: s(j.posted_text, 80),
      snippet: s(j.snippet, 600),
    }))
    .filter((j: Listed) => j.external_id && j.url && j.title)
    .slice(0, 400);

  // De-duplicate within the batch
  const uniq = new Map<string, Listed>();
  for (const j of incoming) uniq.set(`${j.portal}:${j.external_id}`, j);
  const batch = [...uniq.values()];

  const { data: profile } = await db.from("profiles").select("prefs, cv_text").eq("id", user.id).single();
  const prefs = mergePrefs(profile?.prefs);

  // Which ones have we already seen?
  const seen = new Set<string>();
  for (const portal of new Set(batch.map((j) => j.portal))) {
    const ids = batch.filter((j) => j.portal === portal).map((j) => j.external_id);
    const { data } = await db.from("jobs").select("external_id").eq("user_id", user.id).eq("portal", portal).in("external_id", ids);
    for (const r of data || []) seen.add(`${portal}:${r.external_id}`);
  }
  const fresh = batch.filter((j) => !seen.has(`${j.portal}:${j.external_id}`));

  const excluded = (c?: string) =>
    !!c && prefs.exclude_companies.some((x) => x && c.toLowerCase().includes(x.toLowerCase()));

  const candidates = fresh.filter((j) => !excluded(j.company));
  let relevant: Set<number>;
  try {
    relevant = await triageTitles(
      { cv_text: profile?.cv_text || "" },
      prefs,
      candidates.map((j, k) => ({ k, title: j.title || "", company: j.company || "", location: j.location || "" }))
    );
  } catch {
    relevant = new Set(candidates.map((_, k) => k)); // AI busy → keep everything, Tailor will judge
  }

  const rows = fresh.map((j) => {
    const k = candidates.indexOf(j);
    const isExcluded = excluded(j.company);
    const keep = !isExcluded && relevant.has(k);
    return {
      user_id: user.id,
      ...j,
      status: keep ? "found" : "skipped",
      verdict: keep ? null : "skip",
      analysis: keep
        ? null
        : { skip_reason: isExcluded ? "Excluded employer" : "Not related to your target roles", matched: [], gaps: [], match_percent: 0, verdict: "skip", must_haves_met: "", summary: "" },
    };
  });
  if (rows.length) {
    const { error } = await db.from("jobs").upsert(rows, { onConflict: "user_id,portal,external_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }

  // Job pages to open next: everything still waiting for its description, newest first.
  const { data: queue } = await db
    .from("jobs")
    .select("id, url, portal")
    .eq("user_id", user.id)
    .eq("status", "found")
    .order("created_at", { ascending: false })
    .limit(prefs.max_jobs_per_run);

  return json({
    received: batch.length,
    new: fresh.length,
    kept: rows.filter((r) => r.status === "found").length,
    need_details: queue || [],
  });
});
