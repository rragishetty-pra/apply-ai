export type Portal = "linkedin" | "naukri" | "indeed" | "other";

/** Answers a user gives during onboarding. Stored in profiles.prefs. */
export interface Prefs {
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
}

export const DEFAULT_PREFS: Prefs = {
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
  portals: ["linkedin", "naukri", "indeed"],
  max_jobs_per_run: 40,
  daily_run_hour: 13,
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
  | "scoring"    // Tailor is working on it
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
}

export interface TailorEdits {
  changes: { i: number; before: string; after: string; why: string }[];
  rejected: number;          // edits Tailor proposed that failed the safety checks
  note: string;
}

export function mergePrefs(p: Partial<Prefs> | null | undefined): Prefs {
  return { ...DEFAULT_PREFS, ...(p || {}) };
}
