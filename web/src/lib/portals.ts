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

/** Search pages Hunter opens in the user's own Chrome. Last-24h postings where the portal supports it. */
export function buildSearchPlan(prefs: Prefs): SearchTask[] {
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
        const url = searchUrl(id, q, place);
        if (!url || seen.has(url)) continue; // portals without a location filter get one task per query
        seen.add(url);
        tasks.push({ portal: id, query: q, location: place.label, url, link_pattern: info.linkPattern, login_pattern: info.loginPattern });
      }
    }
  }
  return tasks;
}

function searchUrl(portal: string, q: string, place: Place): string | null {
  const india = place.kind !== "abroad";
  switch (portal) {
    case "linkedin": {
      const base = `https://www.linkedin.com/jobs/search/?keywords=${enc(q)}&f_TPR=r86400`;
      if (place.kind === "remote") return `${base}&location=India&f_WT=2`;
      return `${base}&location=${enc(place.label)}`;
    }
    case "naukri": {
      if (!india) return null;
      if (place.kind === "remote") return `https://www.naukri.com/${slug(q)}-jobs?k=${enc(q)}&wfhType=2&jobAge=1`;
      return `https://www.naukri.com/${slug(q)}-jobs-in-${slug(place.label)}?k=${enc(q)}&l=${enc(place.label)}&jobAge=1`;
    }
    case "indeed": {
      if (!india) return null;
      return `https://in.indeed.com/jobs?q=${enc(q)}&l=${enc(place.kind === "remote" ? "Remote" : place.label)}&fromage=1`;
    }
    case "foundit": {
      if (!india) return null;
      return `https://www.foundit.in/srp/results?query=${enc(q)}&locations=${enc(place.kind === "remote" ? "Work From Home" : place.label)}&jobFreshness=1`;
    }
    case "shine": {
      if (!india) return null;
      return place.kind === "remote"
        ? `https://www.shine.com/job-search/${slug(q)}-jobs?wfh=1`
        : `https://www.shine.com/job-search/${slug(q)}-jobs-in-${slug(place.label)}`;
    }
    case "hirist":
      return india ? `https://www.hirist.tech/k/${slug(q)}-jobs` : null; // no location filter
    case "instahyre":
      return india ? "https://www.instahyre.com/candidate/opportunities/?matching=true" : null; // matched to their profile
    case "cutshort":
      return india ? `https://cutshort.io/jobs/${slug(q)}-jobs${place.kind === "city" ? `-in-${slug(place.label)}` : ""}` : null;
    case "glassdoor":
      if (!india) return null;
      return `https://www.glassdoor.co.in/Job/jobs.htm?sc.keyword=${enc(q)}&locKeyword=${enc(place.kind === "remote" ? "India" : place.label)}${place.kind === "remote" ? "&remoteWorkType=1" : ""}&fromAge=1`;
    case "wellfound":
      return place.kind === "remote" ? `https://wellfound.com/role/r/${slug(q)}` : india ? `https://wellfound.com/role/l/${slug(q)}/${slug(place.label)}` : null;
    case "iimjobs":
      return india ? `https://www.iimjobs.com/search/${slug(q)}-jobs${place.kind === "city" ? `-in-${slug(place.label)}` : ""}` : null;
    default:
      return null;
  }
}
