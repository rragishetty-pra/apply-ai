/* ─────────────────────── Safety checks on Tailor's edits ─────────────────────── */

const PROTECTED = [
  /@/, // emails
  /\+?\d[\d\s-]{8,}\d/, // phone numbers
  /https?:\/\/|www\.|linkedin\.com/i,
  /\b(19|20)\d{2}\b/, // years → dates, education lines
  /\t/, // tab-aligned lines are usually "Company<tab>Dates"
];

export function vetEdits(
  paragraphs: { i: number; text: string }[],
  edits: { i: number; text: string; why: string }[] | undefined
) {
  const byIndex = new Map(paragraphs.map((p) => [p.i, p.text]));
  const firstIndexes = new Set(paragraphs.slice(0, 3).map((p) => p.i)); // name / title / contact block
  const accepted: { i: number; before: string; after: string; why: string }[] = [];
  let rejected = 0;
  const seen = new Set<number>();

  for (const e of edits || []) {
    const before = byIndex.get(Number(e.i));
    const after = (e.text || "").trim();
    const ok =
      before !== undefined &&
      !seen.has(e.i) &&
      !firstIndexes.has(e.i) &&
      !PROTECTED.some((re) => re.test(before)) &&
      after.length > 0 &&
      before.trim() !== after &&
      after.length <= Math.max(before.length * 1.35, before.length + 40) &&
      after.length >= before.length * 0.6 &&
      before.length >= 25; // skip headings and short labels
    if (ok) {
      accepted.push({ i: e.i, before, after, why: e.why || "" });
      seen.add(e.i);
    } else rejected++;
  }
  return { accepted, rejected };
}
