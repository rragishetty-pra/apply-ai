import type { InterviewPrep, UpskillPlan } from "./types";
import type { CoachReply } from "./coach";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Fold what Coach added during a chat back into the saved prep/plan. Returns a short note of what changed. */
export function mergeReply(
  kind: "interview" | "upskill",
  result: InterviewPrep | UpskillPlan | null,
  r: CoachReply
): { result: InterviewPrep | UpskillPlan | null; added: string | null } {
  if (!result) return { result, added: null };
  const notes: string[] = [];

  if (kind === "interview") {
    const prep = { ...(result as InterviewPrep) };
    const have = new Set((prep.questions || []).map((q) => norm(q.question)));
    const fresh = (r.add_questions || []).filter((q) => q?.question && !have.has(norm(q.question)));
    if (fresh.length) {
      prep.questions = [...(prep.questions || []), ...fresh].slice(0, 60);
      notes.push(`${fresh.length} question${fresh.length > 1 ? "s" : ""} added to your prep`);
    }
    if (Array.isArray(r.prep_plan) && r.prep_plan.length) {
      prep.prep_plan = r.prep_plan.filter((d) => d?.day && Array.isArray(d.tasks));
      notes.push("prep plan updated");
    }
    return { result: prep, added: notes.join(", ") || null };
  }

  const plan = { ...(result as UpskillPlan) };
  if (Array.isArray(r.weekly_plan) && r.weekly_plan.length) {
    plan.weekly_plan = r.weekly_plan.filter((w) => w?.week && w?.focus);
    notes.push("weekly plan updated");
  }
  return { result: plan, added: notes.join(", ") || null };
}
