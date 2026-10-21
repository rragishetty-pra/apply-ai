import "server-only";
import { supabaseAdmin } from "./supabase-admin";
import { askJSON } from "./gemini";
import { mergePrefs } from "./types";
import { cleanPeople, startOfTodayIST, type RawPerson } from "./networker-people";

export { startOfTodayIST };

/** How many new people the user has messaged today, and their cap. */
export async function capStatus(userId: string) {
  const db = supabaseAdmin();
  const [{ count }, { data: profile }] = await Promise.all([
    db.from("contacts").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("sent_at", startOfTodayIST()),
    db.from("profiles").select("prefs").eq("id", userId).single(),
  ]);
  const cap = mergePrefs(profile?.prefs).networker_daily_cap;
  return { sentToday: count || 0, cap };
}

interface Drafted {
  people: { i: number; kind: string; why: string; note: string; message: string }[];
}

/**
 * Networker: from people the extension found on LinkedIn for one job, pick the best few and draft
 * referral asks in the user's own voice. The user sends every message themselves.
 */
export async function draftForJob(userId: string, jobId: string, raw: RawPerson[]) {
  const db = supabaseAdmin();
  const { data: job } = await db
    .from("jobs")
    .select("id, title, company, location, url, analysis")
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!job) return { added: 0, reason: "job_missing" as const };

  // Skip anyone already suggested for this job, or already messaged for any job.
  const { data: existing } = await db.from("contacts").select("profile_url, job_id, status").eq("user_id", userId);
  const taken = new Set(
    (existing || []).filter((c) => c.job_id === jobId || c.status !== "suggested").map((c) => c.profile_url)
  );
  const people = cleanPeople(raw, job.company || "").filter((p) => !taken.has(p.profile_url));
  if (!people.length) return { added: 0, reason: "no_people" as const };

  const { sentToday, cap } = await capStatus(userId);
  const room = Math.max(0, Math.min(5, cap - sentToday));
  if (!room) return { added: 0, reason: "cap" as const };

  const { data: profile } = await db.from("profiles").select("full_name, cv_text, prefs").eq("id", userId).single();
  const first = (profile?.full_name || "").split(" ")[0] || "";
  const list = people.map((p, i) => `[${i}] ${p.name} | ${p.headline || ""} | ${p.location || ""} | ${p.degree || ""}`).join("\n");

  const out = await askJSON<Drafted>(
    `You are "Networker", helping ${profile?.full_name || "a job seeker"} get a referral for:
${job.title} at ${job.company} (${job.location || ""}). Job link: ${job.url}

From the LinkedIn people below, pick up to ${room} who are most likely to help, in this order of preference:
someone in the same team or function as the job, a recruiter / talent acquisition person at ${job.company},
a likely hiring manager, someone who shares a past employer or college with the candidate (see CV), 2nd-degree connections.
Only pick people who currently work at ${job.company}.

For each, write:
- note: a LinkedIn connection note, MAX 280 characters, in the candidate's own voice. Natural and specific, not salesy,
  no "I hope this finds you well", no emojis. Mention the role and one genuine reason for reaching out to THEM.
- message: the follow-up after they accept, 60–110 words: who the candidate is in one line (from the CV), why they fit
  this role (one concrete thing), a clear, easy ask for a referral (offer to share CV and the job link), and thanks.
  Sound like a real person who writes well, lightly polished. Sign off "${first}".
- kind: recruiter | hiring_manager | team_member | alumni | other
- why: one short line on why this person.

Return ONLY JSON: {"people":[{"i": index, "kind", "why", "note", "message"}]}

PEOPLE:
${list}

CANDIDATE CV:
"""
${(profile?.cv_text || "").slice(0, 8000)}
"""`,
    { temperature: 0.6 }
  );

  const rows = (out.people || [])
    .filter((d) => Number.isInteger(d.i) && people[d.i] && d.note && d.message)
    .slice(0, room)
    .map((d) => {
      const p = people[d.i];
      return {
        user_id: userId,
        job_id: jobId,
        company: job.company,
        name: p.name,
        headline: p.headline,
        profile_url: p.profile_url,
        location: p.location,
        degree: p.degree,
        kind: String(d.kind || "other").slice(0, 30),
        why: String(d.why || "").slice(0, 300),
        note: String(d.note).slice(0, 300),
        message: String(d.message).slice(0, 1500),
      };
    });
  if (rows.length) {
    const { error } = await db.from("contacts").upsert(rows, { onConflict: "user_id,job_id,profile_url", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  return { added: rows.length, reason: rows.length ? null : ("no_match" as const) };
}
