/** Pure helpers for Networker (tested without a database). */

export interface RawPerson {
  name?: unknown;
  headline?: unknown;
  profile_url?: unknown;
  location?: unknown;
  degree?: unknown;
}

const s = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");

const companyWords = (company: string) =>
  company
    .toLowerCase()
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !["pvt", "private", "ltd", "limited", "inc", "llp", "llc", "the", "india", "technologies", "solutions", "services", "corp", "group"].includes(w));

/** Normalise LinkedIn profile URLs to https://www.linkedin.com/in/<slug>/ */
export function normProfileUrl(u: string): string | null {
  const m = u.match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (!m) return null;
  const slug = decodeURIComponent(m[1]);
  if (/^ACo|^ACw/.test(slug) && slug.length > 30) return `https://www.linkedin.com/in/${m[1]}/`; // opaque ids still work
  return `https://www.linkedin.com/in/${encodeURIComponent(slug)}/`;
}

/** Clean scraped people, drop duplicates, hidden "LinkedIn Member"s, and people not at the company. */
export function cleanPeople(raw: RawPerson[], company: string) {
  const words = companyWords(company);
  const seen = new Set<string>();
  const out: { name: string; headline: string | null; profile_url: string; location: string | null; degree: string | null; atCompany: boolean }[] = [];
  for (const r of raw.slice(0, 80)) {
    const name = s(r.name, 120).replace(/\s*(View .*profile|• .*)$/i, "");
    const url = normProfileUrl(s(r.profile_url, 400));
    if (!name || !url || /^linkedin member$/i.test(name) || seen.has(url)) continue;
    seen.add(url);
    const headline = s(r.headline, 300) || null;
    const hay = `${headline || ""}`.toLowerCase();
    const atCompany = words.length ? words.some((w) => hay.includes(w)) : true;
    const degree = (s(r.degree, 20).match(/1st|2nd|3rd\+?/) || [null])[0];
    out.push({ name, headline, profile_url: url, location: s(r.location, 120) || null, degree, atCompany });
  }
  // Only people whose LinkedIn headline or summary names the company.
  const matched = out.filter((p) => p.atCompany);
  return matched.slice(0, 25).map(({ atCompany: _ignored, ...p }) => p);
}

/** Midnight today in India (UTC+5:30). */
export function startOfTodayIST(): string {
  const ist = new Date(Date.now() + 5.5 * 3600_000);
  ist.setUTCHours(0, 0, 0, 0);
  return new Date(ist.getTime() - 5.5 * 3600_000).toISOString();
}
