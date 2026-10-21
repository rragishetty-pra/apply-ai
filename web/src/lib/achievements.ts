import "server-only";
import { askJSON } from "./gemini";
import type { Achievement, AchievementKind } from "./types";

export const KINDS: AchievementKind[] = ["certification", "award", "appreciation", "recommendation", "other"];

const s = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/** Clean one achievement coming from a form, the AI, or the extension. Returns null if unusable. */
export function cleanAchievement(a: Record<string, unknown>) {
  const title = s(a.title, 200);
  if (!title) return null;
  const kind = KINDS.includes(a.kind as AchievementKind) ? (a.kind as AchievementKind) : "other";
  const url = s(a.url, 500);
  return {
    kind,
    title,
    issuer: s(a.issuer, 200) || null,
    date_text: s(a.date_text, 40) || null,
    description: s(a.description, 1500) || null,
    url: /^https?:\/\//.test(url) ? url : null,
  };
}

const key = (a: { title: string; issuer?: string | null }) =>
  `${a.title}|${a.issuer || ""}`.toLowerCase().replace(/[^a-z0-9|]/g, "");

interface Section { section: string; items: string[] }

/** Turn raw text the extension read from the user's LinkedIn pages into achievement suggestions. */
export async function parseLinkedIn(sections: Section[], existing: Pick<Achievement, "title" | "issuer">[]) {
  const blocks = sections
    .filter((x) => x.items?.length)
    .map((x) => `## ${x.section}\n` + x.items.slice(0, 40).map((t, i) => `[${i + 1}] ${t.slice(0, 1200)}`).join("\n"))
    .join("\n\n");
  if (!blocks) return [];

  const out = await askJSON<{ achievements: Record<string, unknown>[] }>(
    `You read text copied from a person's own LinkedIn profile pages and pull out their achievements.
Return JSON {"achievements":[{kind,title,issuer,date_text,description,url}]} where kind is one of:
"certification" (a credential or course certificate), "award" (a formal award or honour),
"appreciation" (recognition from a manager, client or employer, e.g. a "spot award" post or kudos),
"recommendation" (a written recommendation someone gave them), "other".
Rules:
- Only include things that are clearly about THIS person's own achievements. Skip their general posts,
  reshares, job ads, congratulations they gave to others, and recommendations they wrote for others.
- title: short (e.g. "AWS Certified Cloud Practitioner", "Star Performer Award", "Recommendation from Priya S.").
- issuer: certifying body or company. date_text: as written ("Mar 2024"). description: one or two plain sentences
  (for recommendations: a short faithful excerpt). url: only if a credential/post link appears in the text.
- Do not invent anything.

${blocks.slice(0, 30000)}`,
    { temperature: 0.1 }
  );

  const seen = new Set(existing.map(key));
  const result = [];
  for (const raw of out.achievements || []) {
    const a = cleanAchievement(raw);
    if (!a || seen.has(key(a))) continue;
    seen.add(key(a));
    result.push(a);
  }
  return result.slice(0, 60);
}

/** Short text block of confirmed achievements, for Tailor and Coach prompts. */
export function achievementsForPrompt(list: Pick<Achievement, "kind" | "title" | "issuer" | "date_text" | "description">[]) {
  if (!list.length) return "none listed";
  return list
    .slice(0, 30)
    .map((a) => `- [${a.kind}] ${a.title}${a.issuer ? ` — ${a.issuer}` : ""}${a.date_text ? ` (${a.date_text})` : ""}${a.description ? `: ${a.description.slice(0, 200)}` : ""}`)
    .join("\n");
}
