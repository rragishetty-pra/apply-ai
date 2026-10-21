import { handle, HttpError, json, requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { achievementsForPrompt } from "@/lib/achievements";
import { askCoach } from "@/lib/coach";
import { mergeReply } from "@/lib/coach-merge";
import { AIServiceError } from "@/lib/gemini";
import { mergePrefs, type CoachMessage, type CoachSession } from "@/lib/types";

export const maxDuration = 60;
type Ctx = { params: Promise<{ id: string }> };

/** Ask Coach a follow-up inside a session. Coach may search the web and update the saved prep. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const body = await req.json();
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 3000) : "";
  if (!message) throw new HttpError(400, "Type a message for Coach.");

  const db = supabaseAdmin();
  const [{ data: s }, { data: profile }, { data: ach }] = await Promise.all([
    db.from("coach_sessions").select("*").eq("id", id).eq("user_id", user.id).maybeSingle<CoachSession>(),
    db.from("profiles").select("cv_text, prefs").eq("id", user.id).single(),
    db.from("achievements").select("kind, title, issuer, date_text, description").eq("user_id", user.id).eq("status", "confirmed"),
  ]);
  if (!s) throw new HttpError(404, "That Coach session no longer exists.");
  const person = { cvText: profile?.cv_text || "", prefs: mergePrefs(profile?.prefs), achievements: achievementsForPrompt(ach || []) };
  const history: CoachMessage[] = Array.isArray(s.messages) ? s.messages : [];

  let out;
  try {
    out = await askCoach(person, { kind: s.kind, title: s.title, result: s.result, history, message });
  } catch (e) {
    if (e instanceof AIServiceError) throw e;
    throw new HttpError(502, "Coach couldn't answer that one. Try asking again.");
  }

  const merged = mergeReply(s.kind, s.result, out.data);
  const now = new Date().toISOString();
  const messages: CoachMessage[] = [
    ...history,
    { role: "user" as const, text: message, at: now },
    { role: "coach" as const, text: String(out.data.reply || "").slice(0, 8000), at: now, ...(merged.added ? { added: merged.added } : {}) },
  ].slice(-80);

  const seen = new Set((s.sources || []).map((x) => x.url));
  const sources = [...(s.sources || []), ...out.sources.filter((x) => !seen.has(x.url))].slice(0, 40);

  const { data, error } = await db
    .from("coach_sessions")
    .update({ messages, result: merged.result, sources, ...(out.searchHtml ? { search_html: out.searchHtml } : {}) })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return json({ session: data });
});
