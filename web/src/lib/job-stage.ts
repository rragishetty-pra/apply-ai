import type { Contact, Job } from "./types";

/**
 * One clear status per job across all agents, plus the next step. Pure (tested).
 *
 * Order of the pipeline:
 *   reading → waiting for Tailor → (not a match | potential | wishlist | tailored)
 *   tailored → preparing apply pack → waiting for referral | referral received | ready to apply
 *   → applied → interview → offer | not selected
 */
export type StageKey =
  | "reading" | "queued" | "problem"
  | "not_match" | "not_interested"
  | "potential" | "wishlist"
  | "pack" | "waiting_referral" | "referral_received" | "ready"
  | "applied" | "follow_up" | "interview" | "offer" | "rejected";

export type Group = "action" | "waiting" | "applied" | "interviews" | "wishlist" | "potential" | "progress" | "closed";

export interface Stage {
  key: StageKey;
  label: string;
  detail: string;            // short supporting line, e.g. "2 people asked · apply by 24 Oct"
  tone: "action" | "wait" | "good" | "muted" | "warn" | "bad";
  group: Group;
  next: { label: string; kind: "apply" | "prepare" | "find_people" | "network" | "coach" | "open" | "learn" | "retry" | "none" } | null;
  step: number;              // 0–6 position on the progress line (found, scored, pack, referral, applied, interview, offer)
}

const DAY = 86400_000;
const fmt = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const daysAgo = (iso: string, now: number) => Math.max(0, Math.floor((now - new Date(iso).getTime()) / DAY));
const ago = (n: number) => (n === 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`);

export const FOLLOW_UP_DAYS = 10;

export function jobStage(job: Job, contacts: Contact[] = [], now = Date.now()): Stage {
  const asked = contacts.filter((c) => c.sent_at).length;
  const drafted = contacts.filter((c) => c.status === "suggested").length;
  const referred = contacts.some((c) => c.status === "referred");

  // After applying
  if (job.stage === "offer") return { key: "offer", label: "Offer", detail: "Congratulations!", tone: "good", group: "interviews", next: null, step: 6 };
  if (job.stage === "rejected") return { key: "rejected", label: "Not selected", detail: job.applied_at ? `Applied ${fmt(new Date(job.applied_at))}` : "", tone: "muted", group: "closed", next: null, step: 4 };
  if (job.stage === "interview")
    return {
      key: "interview",
      label: "Interview",
      detail: job.interview_at ? `On ${job.interview_at}` : "Date not set",
      tone: "good",
      group: "interviews",
      next: { label: "Prep with Coach", kind: "coach" },
      step: 5,
    };
  if (job.applied) {
    const d = job.applied_at ? daysAgo(job.applied_at, now) : null;
    const viaReferral = referred ? " with a referral" : "";
    if (d !== null && d >= FOLLOW_UP_DAYS)
      return { key: "follow_up", label: "Applied, no news", detail: `Applied${viaReferral} ${ago(d)}. A polite follow-up is fair now.`, tone: "warn", group: "applied", next: asked ? { label: "Open Network", kind: "network" } : { label: "Open job", kind: "open" }, step: 4 };
    return { key: "applied", label: "Applied", detail: d === null ? `Applied${viaReferral}` : `Applied${viaReferral} ${ago(d)}`, tone: "wait", group: "applied", next: null, step: 4 };
  }

  // Before scoring
  if (job.status === "found") return { key: "reading", label: "Reading job", detail: "Hunter will read the full posting on its next pass", tone: "muted", group: "progress", next: null, step: 0 };
  if (["pending", "scoring", "to_tailor", "tailoring"].includes(job.status)) return { key: "queued", label: "Waiting for Tailor", detail: "Scoring and tailoring next", tone: "muted", group: "progress", next: null, step: 0 };
  if (job.status === "error") return { key: "problem", label: "Problem", detail: job.error || "Something went wrong reading this job", tone: "bad", group: "progress", next: { label: "Try again", kind: "retry" }, step: 0 };
  if (job.stage === "not_interested") return { key: "not_interested", label: "Not interested", detail: "", tone: "muted", group: "closed", next: null, step: 1 };
  if (job.status === "skipped") {
    const userSkipped = !job.analysis;
    return userSkipped
      ? { key: "not_interested", label: "Not interested", detail: "", tone: "muted", group: "closed", next: null, step: 1 }
      : { key: "not_match", label: "Not a match", detail: job.analysis?.skip_reason || "", tone: "muted", group: "closed", next: null, step: 1 };
  }
  if (job.status === "stretch") {
    const gaps = (job.analysis?.key_gaps?.length ? job.analysis.key_gaps : job.analysis?.gaps || []).slice(0, 2).join(", ");
    return job.wishlisted
      ? { key: "wishlist", label: "On wishlist", detail: gaps ? `Learn ${gaps}` : "", tone: "action", group: "wishlist", next: { label: "Learning plan", kind: "learn" }, step: 1 }
      : { key: "potential", label: "Potential", detail: gaps ? `Close: needs ${gaps}` : "Close match", tone: "muted", group: "potential", next: { label: "Learning plan", kind: "learn" }, step: 1 };
  }

  // Tailored, not applied
  if (!job.apply_pack)
    return {
      key: "pack",
      label: "Tailored",
      detail: job.error || "Apply pack not ready yet",
      tone: job.error ? "bad" : "action",
      group: "action",
      next: { label: job.error ? "Try apply pack again" : "Prepare apply pack", kind: "prepare" },
      step: 1,
    };
  const openNeeds = (job.apply_pack.needs_you || []).filter((n) => !(n.answer || "").trim()).length;
  const needsNote = openNeeds ? `${openNeeds} question${openNeeds > 1 ? "s need" : " needs"} your answer` : "";

  if (referred)
    return { key: "referral_received", label: "Referral received", detail: ["Apply now and mention your referrer", needsNote].filter(Boolean).join(". "), tone: "action", group: "action", next: { label: "Apply", kind: "apply" }, step: 3 };

  const until = job.referral_wait_until ? new Date(job.referral_wait_until).getTime() : 0;
  if (job.apply_route === "referral_first" && until > now) {
    const people = asked ? `${asked} ${asked > 1 ? "people" : "person"} asked` : drafted ? `${drafted} message${drafted > 1 ? "s" : ""} drafted, not sent` : "No one asked yet";
    return {
      key: "waiting_referral",
      label: "Waiting for referral",
      detail: `${people}. Apply directly from ${fmt(new Date(until))}`,
      tone: asked ? "wait" : "action",
      group: asked ? "waiting" : "action",
      next: asked ? { label: "Open Network", kind: "network" } : drafted ? { label: "Send messages", kind: "network" } : { label: "Find people", kind: "find_people" },
      step: 3,
    };
  }

  const why = job.apply_route === "referral_first" ? "No referral yet, so apply directly" : "Apply directly";
  return { key: "ready", label: "Ready to apply", detail: [why, needsNote].filter(Boolean).join(". "), tone: "action", group: "action", next: { label: "Apply", kind: "apply" }, step: 2 };
}

export const GROUPS: { id: Group | "all"; label: string; hint: string }[] = [
  { id: "action", label: "Needs you", hint: "Ready to apply, or waiting on a step from you" },
  { id: "waiting", label: "Waiting on referral", hint: "You've asked people; Applier will say when to apply directly" },
  { id: "applied", label: "Applied", hint: "Submitted applications" },
  { id: "interviews", label: "Interviews & offers", hint: "Interviews scheduled and offers" },
  { id: "wishlist", label: "Wishlist", hint: "Potential jobs you saved to grow into" },
  { id: "potential", label: "Potential", hint: "Close matches: one or two skills away" },
  { id: "progress", label: "In progress", hint: "Being read or scored by the agents" },
  { id: "closed", label: "Closed", hint: "Not a match, not interested, or not selected" },
  { id: "all", label: "All", hint: "" },
];

export const STEPS = ["Found", "Scored", "Pack ready", "Referral", "Applied", "Interview", "Offer"];
