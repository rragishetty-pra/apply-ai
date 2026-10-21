import "server-only";
import { supabaseAdmin } from "./supabase-admin";
import { askGroundedJSON } from "./gemini";
import { detectAts, detectAtsInHtml, jobDetail, listJobs, locationFits, roleCores, searchPhrase, type AtsRef } from "./ats";
import { mergePrefs } from "./types";
import seed from "./company-seed.json";

export const CHUNK = 15;
const RESOLVE_PER_CHUNK = 3;
const DETAILS_PER_CHUNK = 10;

interface CompanyRow {
  id: string;
  name: string;
  industry: string | null;
  careers_url: string | null;
  ats: string | null;
  ats_key: Record<string, string> | null;
  status: "new" | "resolved" | "unsupported" | "failed";
}

/** First run: load the starter list of leading employers. */
export async function ensureSeeded() {
  const db = supabaseAdmin();
  const { count } = await db.from("companies").select("id", { count: "exact", head: true });
  if (count) return;
  const rows = seed as { name: string; industry: string }[];
  for (let i = 0; i < rows.length; i += 200) {
    await db.from("companies").insert(rows.slice(i, i + 200));
  }
}

async function fetchHtml(url: string) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; ApplyAI-JobSearch/1.0)" }, signal: ctrl.signal, redirect: "follow" });
    return { html: res.ok ? (await res.text()).slice(0, 600_000) : "", finalUrl: res.url };
  } catch {
    return { html: "", finalUrl: url };
  } finally {
    clearTimeout(t);
  }
}

/**
 * One-time per company (shared by every user): find its careers site and which applicant-tracking
 * system it runs on. Supported systems get searched on every Hunter run.
 */
export async function resolveCompany(c: CompanyRow): Promise<CompanyRow> {
  const db = supabaseAdmin();
  let careers = c.careers_url;
  let ref: AtsRef | null = null;
  try {
    if (!careers) {
      const out = await askGroundedJSON<{ careers_url?: string; job_search_url?: string }>(
        `Find the official careers website where ${c.name} lists its job openings in India.
Use Google Search. Prefer the actual job-search page (often hosted on Workday "myworkdayjobs.com", Greenhouse,
Lever, SmartRecruiters, Ashby, SuccessFactors, Oracle, iCIMS or Taleo) over a marketing page.
Return ONLY JSON: {"careers_url": "https://...", "job_search_url": "https://... or empty"}`,
        { temperature: 0 }
      );
      careers = out.data.careers_url || null;
      ref = detectAts(out.data.job_search_url || "") || detectAts(careers || "");
      if (!ref && out.data.job_search_url) {
        const page = await fetchHtml(out.data.job_search_url);
        ref = detectAts(page.finalUrl) || detectAtsInHtml(page.html);
      }
    }
    if (!ref && careers) {
      ref = detectAts(careers);
      if (!ref) {
        const page = await fetchHtml(careers);
        ref = detectAts(page.finalUrl) || detectAtsInHtml(page.html);
      }
    }
    const update = {
      careers_url: careers,
      ats: ref?.ats || null,
      ats_key: ref?.key || null,
      status: ref ? "resolved" : careers ? "unsupported" : "failed",
      error: ref ? null : careers ? "Careers site uses a system Hunter can't search yet" : "Couldn't find a careers site",
      resolved_at: new Date().toISOString(),
    } as const;
    await db.from("companies").update(update).eq("id", c.id);
    return { ...c, ...update };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/limit/i.test(msg)) return c; // AI busy: try again on a later run
    await db.from("companies").update({ status: "failed", error: msg.slice(0, 300), resolved_at: new Date().toISOString() }).eq("id", c.id);
    return { ...c, status: "failed" };
  }
}

/**
 * One slice of a user's careers-page search: up to CHUNK companies from their industries.
 * Matching jobs go straight to Tailor (status "pending") with their full description.
 */
export async function scanChunk(userId: string, cursor: number) {
  const db = supabaseAdmin();
  await ensureSeeded();
  const { data: profile } = await db.from("profiles").select("prefs").eq("id", userId).single();
  const prefs = mergePrefs(profile?.prefs);
  if (!prefs.company_careers || !prefs.target_roles.length) return { next: null, total: 0, scanned: 0, added: 0, resolved: 0 };

  let q = db.from("companies").select("id, name, industry, careers_url, ats, ats_key, status", { count: "exact" });
  if (prefs.company_industries.length) q = q.in("industry", prefs.company_industries);
  const { data, count } = await q.order("name").range(cursor, cursor + CHUNK - 1);
  const total = count || 0;
  let companies = (data || []) as CompanyRow[];

  const excluded = (name: string) => prefs.exclude_companies.some((x) => x && name.toLowerCase().includes(x.toLowerCase()));
  companies = companies.filter((c) => !excluded(c.name));

  // Resolve a few new companies per slice (cached for everyone afterwards).
  let resolved = 0;
  for (const c of companies.filter((x) => x.status === "new").slice(0, RESOLVE_PER_CHUNK)) {
    const r = await resolveCompany(c);
    Object.assign(c, r);
    if (r.status === "resolved") resolved++;
  }

  const cores = roleCores(prefs.target_roles);
  const phrase = searchPhrase(cores);
  const live = companies.filter((c) => c.status === "resolved" && c.ats && c.ats_key);

  const lists = await Promise.allSettled(
    live.map(async (c) => {
      const ref = { ats: c.ats, key: c.ats_key } as AtsRef;
      const jobs = await listJobs(ref, phrase, cores);
      return { c, ref, jobs: jobs.filter((j) => !/\d+\s*locations?/i.test(j.location) ? locationFits(j.location, prefs.locations, prefs.remote_ok) : true) };
    })
  );
  const now = new Date().toISOString();
  if (live.length) await db.from("companies").update({ checked_at: now }).in("id", live.map((c) => c.id));

  const found = lists.flatMap((r) => (r.status === "fulfilled" ? r.value.jobs.map((j) => ({ ...r.value, j })) : []));
  if (!found.length) return { next: cursor + CHUNK < total ? cursor + CHUNK : null, total, scanned: live.length, added: 0, resolved };

  // Skip jobs already in this user's pipeline.
  const ids = found.map((f) => `${f.c.id}:${f.j.id}`.slice(0, 200));
  const { data: have } = await db.from("jobs").select("external_id").eq("user_id", userId).eq("portal", "careers").in("external_id", ids);
  const seen = new Set((have || []).map((h) => h.external_id));
  const fresh = found.filter((f) => !seen.has(`${f.c.id}:${f.j.id}`.slice(0, 200))).slice(0, DETAILS_PER_CHUNK);

  const details = await Promise.allSettled(fresh.map((f) => jobDetail(f.ref, f.j)));
  const rows = fresh
    .map((f, i) => {
      const d = details[i].status === "fulfilled" ? details[i].value : null;
      if (!d || d.description.length < 200) return null;
      if (!locationFits(d.location, prefs.locations, prefs.remote_ok)) return null;
      return {
        user_id: userId,
        portal: "careers",
        external_id: `${f.c.id}:${f.j.id}`.slice(0, 200),
        url: f.j.url,
        title: f.j.title.slice(0, 300),
        company: f.c.name,
        location: d.location.slice(0, 300),
        posted_text: f.j.postedDaysAgo === null ? null : f.j.postedDaysAgo === 0 ? "Today" : `${f.j.postedDaysAgo} days ago`,
        description: d.description.slice(0, 20000),
        status: "pending",
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  if (rows.length) await db.from("jobs").upsert(rows, { onConflict: "user_id,portal,external_id", ignoreDuplicates: true });

  return { next: cursor + CHUNK < total ? cursor + CHUNK : null, total, scanned: live.length, added: rows.length, resolved };
}
