import "server-only";
import { askJSON, type Part } from "./gemini";
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
export interface PostIn { date: string; text: string; url: string; images: { mime: string; data: string }[] }

const RULES = `Return JSON {"achievements":[{kind,title,issuer,date_text,description,url}]} where kind is one of:
"certification" (a credential, course or programme certificate, including "certificate of completion"),
"award" (a formal award or honour), "appreciation" (recognition from an employer, manager or client, such as a
"certificate of recognition", spot award or kudos), "recommendation" (a written recommendation someone gave them), "other".
Rules:
- Only THIS person's own achievements. Skip general posts, reshares, job ads, congratulations they gave to others,
  and recommendations they wrote for others.
- A post where they share a certificate (in the text OR in the attached image), or say they completed a course,
  workshop or programme, IS an achievement. Read the certificate image: it usually shows the exact title, the issuer
  (logo/organisation) and the date.
- title: short and specific, e.g. "Generative AI Mastermind", "AI Tools and ChatGPT Workshop",
  "Certificate of Recognition – Above and Beyond the Call of Duty". issuer: the organisation (e.g. "Outskill", "be10X", "VRIZE").
- date_text: from the certificate if shown (e.g. "Aug 2022"), otherwise the post date.
- description: one or two plain sentences on what it was for (for recommendations: a short faithful excerpt).
- url: the post link if given.
- If the same certificate appears twice, list it once. Do not invent anything.`;

/** Turn what the extension read on the user's own LinkedIn into achievement suggestions. */
export async function parseLinkedIn(sections: Section[], existing: Pick<Achievement, "title" | "issuer">[], posts: PostIn[] = []) {
  const blocks = sections
    .filter((x) => x.items?.length)
    .map((x) => `## ${x.section}\n` + x.items.slice(0, 40).map((t, i) => `[${i + 1}] ${t.slice(0, 1200)}`).join("\n"))
    .join("\n\n");
  if (!blocks && !posts.length) return [];

  const parts: Part[] = [
    { text: `You read a person's own LinkedIn profile sections and posts and pull out their achievements.\n${RULES}\n\n${blocks.slice(0, 20000) || "(no profile sections found)"}` },
  ];
  let images = 0;
  if (posts.length) {
    parts.push({ text: "\n## Their own posts (with attached images where present)" });
    for (const [i, p] of posts.slice(0, 30).entries()) {
      parts.push({ text: `\nPOST ${i + 1} (posted ${p.date || "date unknown"})${p.url ? ` ${p.url}` : ""}:\n${p.text.slice(0, 1500)}` });
      for (const img of p.images.slice(0, 2)) {
        if (images >= 12) break;
        parts.push({ inline_data: { mime_type: img.mime, data: img.data } });
        images++;
      }
    }
  }

  // Reading certificate images needs the main model; text-only can use the cheaper one.
  const out = await askJSON<{ achievements: Record<string, unknown>[] }>(parts, {
    temperature: 0.1,
    tier: images ? "main" : "lite",
    maxTokens: 4096,
  });

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
