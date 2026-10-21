import type { ApplyPack } from "./types";

const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);

/** Clean up what the AI returned into a pack the UI can trust. Pure function (tested). */
export function finalizePack(
  raw: Partial<ApplyPack>,
  ctx: { jobUrl: string; company: string | null; joiningText: string; standardAnswers: Record<string, string>; sources: { title: string; url: string }[] }
): ApplyPack {
  const route = raw.route === "referral_first" ? "referral_first" : "direct";

  const answers = (Array.isArray(raw.answers) ? raw.answers : [])
    .map((a) => ({ question: str(a?.question, 200), answer: str(a?.answer, 600) }))
    .filter((a) => a.question && a.answer);
  if (ctx.joiningText && !answers.some((a) => /join|notice|start/i.test(a.question))) {
    answers.unshift({ question: "Earliest joining date", answer: ctx.joiningText });
  }

  const seen = new Set<string>();
  const needs_you = (Array.isArray(raw.needs_you) ? raw.needs_you : [])
    .map((n) => {
      const question = str(n?.question, 240);
      const key = slug(str(n?.key, 60) || question);
      return { key, question, why: str(n?.why, 300), ...(ctx.standardAnswers[key] ? { answer: ctx.standardAnswers[key] } : {}) };
    })
    .filter((n) => n.question && n.key && !seen.has(n.key) && (seen.add(n.key), true))
    .slice(0, 10);

  // Never let a "needs you" item also appear as an auto answer.
  const blocked = /(ctc|salary|compensation|reason for leaving|why are you leaving|gap|visa|authori[sz]ation|buyout)/i;
  const safeAnswers = answers.filter((a) => !blocked.test(a.question)).slice(0, 12);

  const company = ctx.company || "the company";
  const where = [
    { label: "Job posting", url: ctx.jobUrl },
    { label: `${company} careers page`, url: `https://www.google.com/search?q=${encodeURIComponent(`${company} careers`)}` },
  ];

  return {
    route,
    route_reason: str(raw.route_reason, 400) || (route === "referral_first" ? "A referral should help here." : "Applying directly is fine here."),
    company_notes: (Array.isArray(raw.company_notes) ? raw.company_notes : []).map((x) => str(x, 200)).filter(Boolean).slice(0, 3),
    where,
    cover_note: str(raw.cover_note, 2000),
    answers: safeAnswers,
    needs_you,
    checklist: (Array.isArray(raw.checklist) ? raw.checklist : []).map((x) => str(x, 240)).filter(Boolean).slice(0, 8),
    earliest_joining: ctx.joiningText,
    sources: ctx.sources.slice(0, 10),
  };
}
