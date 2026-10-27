import { DEFAULT_PORTALS } from "./portal-list";

export type Portal = string;

/** Answers a user gives during onboarding. Stored in profiles.prefs. */
export interface Prefs {
  phone: string;                   // mobile number shared with employers (email comes from sign-in)
  target_roles: string[];          // e.g. ["ETL Test Lead", "Senior ETL QA Engineer"]
  key_skills: string[];            // headline skills to search and match on
  experience_years: number | null;
  locations: string[];             // cities, e.g. ["Hyderabad", "Bengaluru"]
  remote_ok: boolean;
  abroad_ok: boolean;              // open to relocation abroad (with sponsorship)
  abroad_countries: string[];      // empty = any country
  exclude_companies: string[];     // never show jobs from these employers
  notice_period_days: number | null;
  job_types: string[];             // full-time | contract | part-time
  match_threshold: number;         // Tailor only tailors at or above this %
  portals: Portal[];               // portals Hunter should search
  max_jobs_per_run: number;        // cap on job pages Hunter opens per run
  daily_run_hour: number | null;   // 0–23 local hour for the extension's daily run, null = manual only
  company_careers: boolean;        // also search company careers pages
  company_industries: string[];    // industries for careers search; empty = all
  standard_answers: Record<string, string>; // answers the user gave to "needs you" questions, reused by Applier
  networker_daily_cap: number;     // max new people to message per day
}

export const DEFAULT_PREFS: Prefs = {
  phone: "",
  target_roles: [],
  key_skills: [],
  experience_years: null,
  locations: [],
  remote_ok: true,
  abroad_ok: false,
  abroad_countries: [],
  exclude_companies: [],
  notice_period_days: null,
  job_types: ["full-time"],
  match_threshold: 70,
  portals: DEFAULT_PORTALS,
  max_jobs_per_run: 25,
  daily_run_hour: 13,
  company_careers: true,
  company_industries: [],
  standard_answers: {},
  networker_daily_cap: 10,
};

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  cv_path: string | null;
  cv_filename: string | null;
  cv_format: "docx" | "pdf" | null;
  cv_text: string | null;
  cv_paragraphs: { i: number; text: string }[] | null;
  prefs: Partial<Prefs>;
  onboarded: boolean;
  last_hunter_at: string | null;
  portal_status: Record<string, string>;
}

export type JobStatus =
  | "found"      // listed by Hunter, description not fetched yet
  | "pending"    // description fetched, waiting for Tailor
  | "scoring"    // Tailor is quick-scoring it
  | "to_tailor"  // scored as a likely match, full tailoring next
  | "tailoring"  // Tailor is writing the tailored CV
  | "tailored"   // match ≥ threshold, tailored CV ready
  | "stretch"    // close but not enough; gaps recorded
  | "skipped"    // not relevant / excluded
  | "error";

export interface Job {
  id: string;
  portal: Portal;
  external_id: string;
  url: string;
  title: string | null;
  company: string | null;
  location: string | null;
  posted_text: string | null;
  snippet: string | null;
  description: string | null;
  status: JobStatus;
  match_percent: number | null;
  verdict: string | null;
  analysis: Analysis | null;
  tailored_path: string | null;
  tailored_edits: TailorEdits | null;
  error: string | null;
  applied: boolean;
  applied_at: string | null;
  notes: string | null;
  wishlisted: boolean;
  stage: "interview" | "offer" | "rejected" | "not_interested" | null;
  interview_at: string | null;
  apply_pack: ApplyPack | null;
  apply_route: "referral_first" | "direct" | null;
  referral_wait_until: string | null;
  created_at: string;
}

export interface ApplyPack {
  route: "referral_first" | "direct";
  route_reason: string;
  company_notes: string[];             // e.g. "Runs an employee referral programme"
  where: { label: string; url: string }[];
  cover_note: string;
  answers: { question: string; answer: string }[];      // safe to paste
  needs_you: { key: string; question: string; why: string; answer?: string }[]; // never auto-filled
  checklist: string[];
  earliest_joining: string;            // computed from notice period
  sources?: { title: string; url: string }[];
}

export interface Contact {
  id: string;
  job_id: string | null;
  company: string | null;
  name: string;
  headline: string | null;
  profile_url: string;
  location: string | null;
  degree: string | null;
  kind: string | null;
  why: string | null;
  note: string | null;
  message: string | null;
  status: "suggested" | "sent" | "replied" | "referred" | "skipped";
  sent_at: string | null;
  created_at: string;
}

export interface Analysis {
  match_percent: number;
  verdict: "match" | "stretch" | "skip";
  matched: string[];
  gaps: string[];
  must_haves_met: string;    // e.g. "3 of 5"
  summary: string;
  skip_reason?: string;
  key_gaps?: string[];       // potential jobs: the 1–3 skills/tools that would close the gap
}

export interface TailorEdits {
  changes: { i: number; before: string; after: string; why: string }[];
  rejected: number;          // edits Tailor proposed that failed the safety checks
  note: string;
}

export function mergePrefs(p: Partial<Prefs> | null | undefined): Prefs {
  return { ...DEFAULT_PREFS, ...(p || {}) };
}

export type AchievementKind = "certification" | "award" | "appreciation" | "recommendation" | "other";

export interface Achievement {
  id: string;
  kind: AchievementKind;
  title: string;
  issuer: string | null;
  date_text: string | null;
  description: string | null;
  url: string | null;
  source: "manual" | "linkedin";
  status: "confirmed" | "suggested";
  created_at: string;
}

export interface UpskillPlan {
  goal: string;
  summary: string;
  skills: {
    name: string;
    why: string;               // why it matters for the target jobs
    level_needed: string;      // e.g. "working knowledge"
    weeks: number;
    steps: string[];           // what to learn, in order
    resources: { name: string; kind: string; free: boolean; url?: string }[];
    project: string;           // a small project that proves the skill
    show_it: string;           // how to show it on CV / LinkedIn
  }[];
  weekly_plan: { week: string; focus: string }[];
  first_step_today: string;
}

export interface InterviewPrep {
  company: string;
  role: string;
  overview: string;
  rounds: { name: string; format: string; what_they_check: string }[];
  questions: { question: string; type: string; tip: string; source?: string }[];
  recruiters_look_for: string[];
  your_stories: { prompt: string; use: string }[];   // STAR stories from the user's own CV/achievements
  gaps_to_patch: { topic: string; how: string }[];
  prep_plan: { day: string; tasks: string[] }[];
  questions_to_ask: string[];
  confidence_note: string;   // how much real data was found
}

export interface CoachSession {
  id: string;
  job_id: string | null;
  kind: "interview" | "upskill";
  title: string;
  input: Record<string, unknown>;
  result: InterviewPrep | UpskillPlan | null;
  sources: { title: string; url: string }[] | null;
  search_html: string | null;
  error: string | null;
  messages: CoachMessage[];
  research: { site: string; url: string; count: number }[] | null;   // pages read in the user's Chrome
  research_at: string | null;
  created_at: string;
}

export interface CoachMessage {
  role: "user" | "coach";
  text: string;
  at: string;
  added?: string;            // what Coach added to the prep, e.g. "6 more questions"
}
