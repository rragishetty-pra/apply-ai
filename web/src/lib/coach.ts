import "server-only";
import { askGroundedJSON } from "./gemini";
import type { CoachMessage, InterviewPrep, Prefs, UpskillPlan } from "./types";

interface Person {
  cvText: string;
  prefs: Prefs;
  achievements: string;
}

const cv = (t: string) => t.slice(0, 12000);

/* ───────────────────────────── Interview prep ───────────────────────────── */

export async function buildInterviewPrep(
  p: Person,
  job: { company: string; role: string; description?: string | null; gaps?: string[]; interviewAt?: string | null; notes?: string | null },
  firsthand?: string
) {
  const today = new Date().toISOString().slice(0, 10);
  return askGroundedJSON<InterviewPrep>(
    `You are "Coach", an interview-prep researcher. The candidate has an interview for:
ROLE: ${job.role}
COMPANY: ${job.company}
INTERVIEW DATE: ${job.interviewAt || "not given"} (today is ${today})
WHAT THE RECRUITER SAID: ${job.notes || "nothing"}

STEP 1 — RESEARCH. Use Google Search to find what real candidates have shared about interviewing at
${job.company} for "${job.role}" or closely related roles. Look especially at Glassdoor interview reviews,
AmbitionBox interviews, Reddit (e.g. r/developersIndia, r/cscareerquestions), LeetCode Discuss, GeeksforGeeks
interview experiences, Blind, Indeed company interviews, and the company's own careers pages.
Prefer posts from the last 2–3 years. If little exists for this exact role, use the same company's similar
roles, then the same role at similar companies — and say so in confidence_note.

${firsthand ? `ALSO: the candidate's own browser read these interview reviews directly from Glassdoor / AmbitionBox.
They are first-hand and more reliable than search snippets — base the rounds and questions mainly on them,
and set "source" to the site they came from:
"""
${firsthand.slice(0, 24000)}
"""
` : ""}
STEP 2 — PREPARE the candidate using the research and their CV.
Return ONLY JSON with this shape:
{
  "company": string, "role": string,
  "overview": "2–3 plain sentences: how this company's process usually runs for this kind of role",
  "rounds": [{"name": "e.g. Online test / Technical 1 / Managerial / HR", "format": "length, who, online/on-site", "what_they_check": "..."}],
  "questions": [{"question": "a real question people reported (or a close paraphrase)", "type": "technical | scenario | behavioural | HR",
                 "tip": "how THIS candidate should answer, using their CV", "source": "site name, e.g. Glassdoor"}],
  "recruiters_look_for": ["specific things interviewers there value"],
  "your_stories": [{"prompt": "likely question", "use": "which project/achievement from the CV to tell, framed as STAR"}],
  "gaps_to_patch": [{"topic": "a weak spot vs this job", "how": "what to revise in the time left"}],
  "prep_plan": [{"day": "e.g. Day 1 / Tonight / Morning of", "tasks": ["..."]}],
  "questions_to_ask": ["good questions for the candidate to ask them"],
  "confidence_note": "how much real interview data you found and how recent"
}
Give 12–20 questions, mixing technical and behavioural, most relevant first. Fit the prep plan to the days left.
Never invent the candidate's experience; use only their CV and achievements.

JOB DESCRIPTION:
"""
${(job.description || "not available").slice(0, 6000)}
"""
KNOWN GAPS VS THIS JOB: ${(job.gaps || []).join(", ") || "none recorded"}

CANDIDATE'S ACHIEVEMENTS:
${p.achievements}

CANDIDATE'S CV:
"""
${cv(p.cvText)}
"""`
  );
}

/* ────────────────────────────── Upskill plan ────────────────────────────── */

export async function buildUpskillPlan(
  p: Person,
  goal: { skills: string[]; role?: string | null; jobsContext?: string }
) {
  const skills = goal.skills.filter(Boolean).slice(0, 4);
  return askGroundedJSON<UpskillPlan>(
    `You are "Coach", a practical career coach. Make a learning plan so this person can qualify for the jobs they want.
GOAL: ${skills.length ? `learn ${skills.join(", ")}` : "close the gaps"}${goal.role ? ` to become a strong candidate for "${goal.role}"` : ""}.
${goal.jobsContext ? `JOBS THEY ARE AIMING AT (and what those jobs asked for):\n${goal.jobsContext}\n` : ""}
Use Google Search to check current, well-regarded learning resources (official docs, free courses, certifications
that employers in India and abroad actually ask for). Prefer free resources; mark paid ones.

Return ONLY JSON:
{
  "goal": "one line",
  "summary": "2 sentences: where they stand today (from the CV) and what the plan gets them",
  "skills": [{
    "name": string, "why": "why the target jobs want it", "level_needed": "e.g. working knowledge / hands-on with 1 project",
    "weeks": number, "steps": ["ordered, concrete learning steps that build on what the CV already shows"],
    "resources": [{"name": "exact course/doc/cert name", "kind": "course | docs | certification | practice | video", "free": boolean}],
    "project": "one small portfolio project that proves the skill, tied to their domain",
    "show_it": "exactly how to add it to the CV and LinkedIn once done, honestly"
  }],
  "weekly_plan": [{"week": "Week 1", "focus": "..."}],
  "first_step_today": "one thing to do in the next 30 minutes"
}
Assume about 6–8 hours a week alongside a full-time job. Keep it realistic and specific to their background.

CANDIDATE'S ACHIEVEMENTS:
${p.achievements}

CANDIDATE'S CV:
"""
${cv(p.cvText)}
"""`
  );
}

/* ─────────────────────────────── Ask Coach ─────────────────────────────── */

export interface CoachReply {
  reply: string;
  add_questions?: InterviewPrep["questions"];
  prep_plan?: InterviewPrep["prep_plan"];
  weekly_plan?: UpskillPlan["weekly_plan"];
}

export async function askCoach(
  p: Person,
  ctx: { kind: "interview" | "upskill"; title: string; result: unknown; history: CoachMessage[]; message: string }
) {
  const history = ctx.history
    .slice(-12)
    .map((m) => `${m.role === "user" ? "CANDIDATE" : "COACH"}: ${m.text.slice(0, 1500)}`)
    .join("\n");
  const today = new Date().toISOString().slice(0, 10);

  return askGroundedJSON<CoachReply>(
    `You are "Coach", continuing a conversation with a job seeker about: ${ctx.title} (${ctx.kind === "interview" ? "interview prep" : "learning plan"}).
Today is ${today}. Be warm, direct and specific to their CV. Use Google Search when they ask for anything you
should look up (more questions from Glassdoor/AmbitionBox/Reddit, a course, a company fact).

Ways you can help:
- Go deeper: more real questions on a topic, model answers built from THEIR experience, explanations of concepts.
- Mock interview: if they ask to be quizzed, ask ONE question at a time and wait. When they answer, score it
  out of 10, say what was good, what was missing, show a stronger version using their CV, then ask the next one.
- Adjust the plan: if their date, situation or a round result changes, rewrite the plan.

Return ONLY JSON:
{
  "reply": "your message. Plain text; short paragraphs; use '- ' at the start of a line for bullet points.",
  ${ctx.kind === "interview"
    ? `"add_questions": [ {question, type, tip, source} ] — ONLY if you found or wrote new questions worth keeping in their prep,
  "prep_plan": [ {day, tasks[]} ] — ONLY if the plan should change`
    : `"weekly_plan": [ {week, focus} ] — ONLY if the plan should change`}
}

THE CURRENT ${ctx.kind === "interview" ? "PREP" : "PLAN"} (JSON):
${JSON.stringify(ctx.result).slice(0, 12000)}

CANDIDATE'S ACHIEVEMENTS:
${p.achievements}

CANDIDATE'S CV:
"""
${cv(p.cvText)}
"""

CONVERSATION SO FAR:
${history || "(none)"}

CANDIDATE: ${ctx.message}`,
    { temperature: 0.5 }
  );
}
