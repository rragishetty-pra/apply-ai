import "server-only";
import { supabaseAdmin } from "./supabase-admin";
import { scoreAndTailor, vetEdits } from "./agents";
import { applyEdits } from "./docx";
import { HttpError } from "./auth";
import { AIServiceError } from "./gemini";
import { mergePrefs, type Analysis, type Profile, type TailorEdits } from "./types";

export interface TailorStep {
  done: boolean;          // true when nothing is left in the queue
  remaining: number;
  job?: { id: string; title: string | null; company: string | null; status: string; match_percent: number | null };
  rate_limited?: boolean;
}

/** Process ONE pending job (keeps each request short for serverless limits). */
export async function tailorNext(userId: string): Promise<TailorStep> {
  const db = supabaseAdmin();

  const { data: profile } = await db.from("profiles").select("*").eq("id", userId).single<Profile>();
  if (!profile?.cv_text) throw new HttpError(400, "Upload your CV first.");
  const prefs = mergePrefs(profile.prefs);

  // Release jobs stuck in "scoring" for more than 5 minutes (e.g. a crashed request).
  await db
    .from("jobs")
    .update({ status: "pending" })
    .eq("user_id", userId)
    .eq("status", "scoring")
    .lt("updated_at", new Date(Date.now() - 5 * 60_000).toISOString());

  const { data: next } = await db
    .from("jobs")
    .select("id, title, company, location, description")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!next) return { done: true, remaining: 0 };

  // Claim it (only if still pending — protects against two tabs running Tailor).
  const { data: claimed } = await db
    .from("jobs")
    .update({ status: "scoring", updated_at: new Date().toISOString() })
    .eq("id", next.id)
    .eq("status", "pending")
    .select("id");
  if (!claimed?.length) return { done: false, remaining: await countPending(userId) };

  try {
    const ans = await scoreAndTailor(profile, prefs, next);
    const pct = clamp(Math.round(Number(ans.match_percent) || 0), 0, 100);
    const verdict = pct >= prefs.match_threshold && ans.verdict !== "skip" ? "match" : ans.verdict === "match" ? "stretch" : ans.verdict;
    const analysis: Analysis = {
      match_percent: pct,
      verdict,
      matched: ans.matched || [],
      gaps: ans.gaps || [],
      must_haves_met: ans.must_haves_met || "",
      summary: ans.summary || "",
      skip_reason: ans.skip_reason,
    };

    const update: Record<string, unknown> = {
      match_percent: pct,
      verdict,
      analysis,
      error: null,
      updated_at: new Date().toISOString(),
    };

    if (verdict === "match") {
      if (profile.cv_format === "docx" && profile.cv_paragraphs && profile.cv_path) {
        const { accepted, rejected } = vetEdits(profile.cv_paragraphs, ans.edits);
        const file = await db.storage.from("cvs").download(profile.cv_path);
        if (file.error || !file.data) throw new Error("Couldn't read your CV file from storage.");
        const { data } = await applyEdits(new Uint8Array(await file.data.arrayBuffer()), accepted.map((a) => ({ i: a.i, text: a.after })));
        const path = `${userId}/${next.id}.docx`;
        const up = await db.storage.from("tailored").upload(path, data, {
          upsert: true,
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
        if (up.error) throw new Error(up.error.message);
        const edits: TailorEdits = { changes: accepted, rejected, note: ans.note || "" };
        Object.assign(update, { status: "tailored", tailored_path: path, tailored_edits: edits });
      } else {
        // PDF CVs: we can't safely edit the layout, so we give wording suggestions instead.
        const edits: TailorEdits = {
          changes: (ans.edits || []).map((e) => ({ i: -1, before: "", after: e.text, why: e.why })),
          rejected: 0,
          note: (ans.note || "") + " (Your CV is a PDF, so these are suggestions to paste in. Upload a .docx to get ready-made tailored files.)",
        };
        Object.assign(update, { status: "tailored", tailored_edits: edits });
      }
    } else {
      update.status = verdict === "stretch" ? "stretch" : "skipped";
    }

    await db.from("jobs").update(update).eq("id", next.id);
    return {
      done: false,
      remaining: await countPending(userId),
      job: { id: next.id, title: next.title, company: next.company, status: update.status as string, match_percent: pct },
    };
  } catch (e) {
    if (e instanceof AIServiceError) {
      // The AI service is the problem, not this job: put it back in the queue untouched.
      await db.from("jobs").update({ status: "pending" }).eq("id", next.id);
      if (e.status === 429) return { done: false, remaining: await countPending(userId), rate_limited: true };
      throw e; // surfaces the message on the dashboard / extension and stops the loop
    }
    const msg = e instanceof Error ? e.message : String(e);
    await db.from("jobs").update({ status: "error", error: msg.slice(0, 500) }).eq("id", next.id);
    return { done: false, remaining: await countPending(userId), job: { id: next.id, title: next.title, company: next.company, status: "error", match_percent: null } };
  }
}

async function countPending(userId: string): Promise<number> {
  const { count } = await supabaseAdmin()
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "pending");
  return count || 0;
}

const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
