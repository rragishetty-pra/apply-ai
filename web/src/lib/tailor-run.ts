import "server-only";
import { supabaseAdmin } from "./supabase-admin";
import { quickScore, scoreAndTailor, vetEdits } from "./agents";
import { applyEdits } from "./docx";
import { HttpError } from "./auth";
import { AIServiceError } from "./gemini";
import { achievementsForPrompt } from "./achievements";
import { mergePrefs, type Analysis, type Profile, type TailorEdits } from "./types";

export interface TailorStep {
  done: boolean;          // true when nothing is left in the queue
  remaining: number;
  job?: { id: string; title: string | null; company: string | null; status: string; match_percent: number | null };
  rate_limited?: boolean;
}

const MAX_ATTEMPTS = 3;
const QUEUED = ["pending", "to_tailor"];

/**
 * Process ONE step for one job, so each request stays well inside the server's time limit:
 *  - "pending"   → quick score on the cheaper model. Clear skips and stretches finish here;
 *                  matches and near-misses move to "to_tailor".
 *  - "to_tailor" → full score + tailored CV on the main model, in its own request.
 * A job the AI fails on MAX_ATTEMPTS times is set aside with an error, so one slow job
 * can never block the rest of the queue.
 */
export async function tailorNext(userId: string): Promise<TailorStep> {
  const db = supabaseAdmin();

  const { data: profile } = await db.from("profiles").select("*").eq("id", userId).single<Profile>();
  if (!profile?.cv_text) throw new HttpError(400, "Upload your CV first.");
  const prefs = mergePrefs(profile.prefs);

  // Release jobs stuck mid-step for more than 3 minutes (e.g. a request the server cut off).
  const stale = new Date(Date.now() - 3 * 60_000).toISOString();
  await db.from("jobs").update({ status: "pending" }).eq("user_id", userId).eq("status", "scoring").lt("updated_at", stale);
  await db.from("jobs").update({ status: "to_tailor" }).eq("user_id", userId).eq("status", "tailoring").lt("updated_at", stale);

  // Jobs that failed too often → set aside with a clear message.
  await db
    .from("jobs")
    .update({ status: "error", error: "The AI kept timing out on this job. Click Try again to give it another go." })
    .eq("user_id", userId)
    .in("status", QUEUED)
    .gte("tailor_attempts", MAX_ATTEMPTS);

  // Finish half-done jobs first, then fewest attempts, then oldest.
  const { data: next } = await db
    .from("jobs")
    .select("id, title, company, location, description, status, tailor_attempts")
    .eq("user_id", userId)
    .in("status", QUEUED)
    .order("status", { ascending: false }) // "to_tailor" sorts before "pending"
    .order("tailor_attempts", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!next) return { done: true, remaining: 0 };
  const full = next.status === "to_tailor";

  // Claim it (only if still queued — protects against two tabs running Tailor).
  const { data: claimed } = await db
    .from("jobs")
    .update({ status: full ? "tailoring" : "scoring", tailor_attempts: (next.tailor_attempts || 0) + 1, updated_at: new Date().toISOString() })
    .eq("id", next.id)
    .eq("status", next.status)
    .select("id");
  if (!claimed?.length) return { done: false, remaining: await countPending(userId) };

  try {
    const { data: ach } = await db
      .from("achievements")
      .select("kind, title, issuer, date_text, description")
      .eq("user_id", userId)
      .eq("status", "confirmed");
    const achText = achievementsForPrompt(ach || []);

    let ans: Awaited<ReturnType<typeof scoreAndTailor>>;
    if (!full) {
      // Step 1: quick score on the cheaper model.
      const quick = await quickScore(profile, prefs, next, achText);
      const quickPct = clamp(Math.round(Number(quick.match_percent) || 0), 0, 100);
      const worthFull = quick.verdict === "match" || quickPct >= prefs.match_threshold - 5;
      if (worthFull) {
        // Step 2 runs in its own request, so neither step gets near the time limit.
        await db
          .from("jobs")
          .update({ status: "to_tailor", tailor_attempts: 0, match_percent: quickPct, updated_at: new Date().toISOString() })
          .eq("id", next.id);
        return {
          done: false,
          remaining: await countPending(userId),
          job: { id: next.id, title: next.title, company: next.company, status: "to_tailor", match_percent: quickPct },
        };
      }
      ans = { ...quick, edits: undefined, note: undefined } as typeof ans;
    } else {
      // Step 2: full score + tailoring on the main model (matches and near-misses only).
      ans = await scoreAndTailor(profile, prefs, next, achText);
    }

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
      key_gaps: (ans.key_gaps || []).slice(0, 3),
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
      // The AI service is the problem, not this job: put it back in the queue (the attempt still counts).
      await db.from("jobs").update({ status: next.status }).eq("id", next.id);
      if (e.status === 429) return { done: false, remaining: await countPending(userId), rate_limited: true };
      if (e.status === 504) {
        // Too slow this time: carry on with the next job instead of stopping the run.
        return {
          done: false,
          remaining: await countPending(userId),
          job: { id: next.id, title: next.title, company: next.company, status: "retry_later", match_percent: null },
        };
      }
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
    .in("status", QUEUED);
  return count || 0;
}

const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
