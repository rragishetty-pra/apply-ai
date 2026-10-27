import type { Prefs } from "./types";
import { PORTALS } from "./portal-list";

export interface SearchTask {
  portal: string;
  query: string;
  location: string;
  url: string;
  link_pattern?: string;   // for the extension's generic reader
  login_pattern?: string;
}

const enc = encodeURIComponent;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

type Place = { label: string; kind: "city" | "remote" | "abroad" };

/** Days to look back: since the last run (+1 day overlap), 30 on the first run. */
export function lookbackDays(lastRunAt: string | null | undefined): number {
  if (!lastRunAt) return 30;
  const days = Math.ceil((Date.now() - new Date(lastRunAt).getTime()) / 86400_000) + 1;
  return Math.min(30, Math.max(1, days));
}

/** Round up to the nearest window a portal offers. */
const snap = (d: number, steps: number[]) => steps.find((x) => x >= d) ?? steps[steps.length - 1];

/** Search pages Hunter opens in the user's own Chrome, for postings since the last run where the portal supports it. */
export function buildSearchPlan(prefs: Prefs, days = 1): SearchTask[] {
  const queries = prefs.target_roles.slice(0, 3);
  const places: Place[] = [
    ...prefs.locations.slice(0, 3).map((l) => ({ label: l, kind: "city" as const })),
    ...(prefs.remote_ok ? [{ label: "Remote", kind: "remote" as const }] : []),
    ...(prefs.abroad_ok
      ? (prefs.abroad_countries.length ? prefs.abroad_countries.slice(0, 3) : ["Worldwide"]).map((c) => ({ label: c, kind: "abroad" as const }))
      : []),
  ];
  const tasks: SearchTask[] = [];
  const seen = new Set<string>();

  for (const id of prefs.portals) {
    const info = PORTALS.find((p) => p.id === id);
    if (!info) continue;
    for (const q of queries) {
      for (const place of places) {
        const url = searchUrl(id, q, place, days);
        if (!url || seen.has(url)) continue; // portals without a location filter get one task per query
        seen.add(url);
        tasks.push({ portal: id, query: q, location: place.label, url, link_pattern: info.linkPattern, login_pattern: info.loginPattern });
      }
    }
  }
  return tasks;
}

function searchUrl(portal: string, q: string, place: Place, days: number): string | null {
  const india = place.kind !== "abroad";
  switch (portal) {
    case "linkedin": {
      // LinkedIn's AI job search ignores the location box but understands it written into the query.
      const phrase = place.kind === "remote" ? `${q} remote jobs in India` : place.label === "Worldwide" ? `${q} jobs` : `${q} jobs in ${place.label}`;
      return `https://www.linkedin.com/jobs/search-results/?keywords=${enc(phrase)}&f_TPR=r${days * 86400}${place.kind === "remote" ? "&f_WT=2" : ""}`;
    }
    case "naukri": {
      if (!india) return null;
      if (place.kind === "remote") return `https://www.naukri.com/${slug(q)}-jobs?k=${enc(q)}&wfhType=2&jobAge=${snap(days, [1, 3, 7, 15, 30])}`;
      return `https://www.naukri.com/${slug(q)}-jobs-in-${slug(place.label)}?k=${enc(q)}&l=${enc(place.label)}&jobAge=${snap(days, [1, 3, 7, 15, 30])}`;
    }
    case "indeed": {
      if (!india) return null;
      return `https://in.indeed.com/jobs?q=${enc(q)}&l=${enc(place.kind === "remote" ? "Remote" : place.label)}&fromage=${snap(days, [1, 3, 7, 14])}`;
    }
    case "foundit": {
      if (!india) return null;
      return `https://www.foundit.in/srp/results?query=${enc(q)}&locations=${enc(place.kind === "remote" ? "Work From Home" : place.label)}&jobFreshness=30`; // low volume: always the last 30 days (repeats are skipped)
    }
    case "shine": {
      if (!india) return null;
      return place.kind === "remote"
        ? `https://www.shine.com/job-search/${slug(q)}-jobs?wfh=1`
        : `https://www.shine.com/job-search/${slug(q)}-jobs-in-${slug(place.label)}`;
    }
    case "hirist":
      return india ? `https://www.hirist.tech/search/${slug(q)}-jobs` : null; // no location filter; Tailor checks the city
    case "instahyre":
      // Public search; the extension reads aai_q / aai_l and calls Instahyre's own search from that page.
      return india ? `https://www.instahyre.com/search-jobs/?aai_q=${enc(q)}&aai_l=${enc(place.kind === "remote" ? "Remote" : place.label)}` : null;
    case "cutshort":
      return india ? `https://cutshort.io/jobs/${slug(q)}-jobs${place.kind === "city" ? `-in-${slug(place.label)}` : ""}` : null;
    case "glassdoor":
      if (!india) return null;
      return `https://www.glassdoor.co.in/Job/jobs.htm?sc.keyword=${enc(q)}&locKeyword=${enc(place.kind === "remote" ? "India" : place.label)}${place.kind === "remote" ? "&remoteWorkType=1" : ""}&fromAge=${snap(days, [1, 3, 7, 14, 30])}`;
    case "wellfound":
      return place.kind === "remote" ? `https://wellfound.com/role/r/${slug(q)}` : india ? `https://wellfound.com/role/l/${slug(q)}/${slug(place.label)}` : null;
    case "iimjobs":
      return india ? `https://www.iimjobs.com/search/${slug(q)}-jobs${place.kind === "city" ? `-in-${slug(place.label)}` : ""}` : null;
    default:
      return null;
  }
}
