import type { Portal, Prefs } from "./types";

export interface SearchTask {
  portal: Portal;
  query: string;
  location: string;
  url: string;
}

const enc = encodeURIComponent;
const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Search pages Hunter should open in the user's own Chrome. Last-24h postings where the portal supports it. */
export function buildSearchPlan(prefs: Prefs): SearchTask[] {
  const queries = prefs.target_roles.slice(0, 3);
  const places: { label: string; kind: "city" | "remote" | "abroad" }[] = [
    ...prefs.locations.slice(0, 3).map((l) => ({ label: l, kind: "city" as const })),
    ...(prefs.remote_ok ? [{ label: "Remote", kind: "remote" as const }] : []),
    ...(prefs.abroad_ok
      ? (prefs.abroad_countries.length ? prefs.abroad_countries.slice(0, 3) : ["Worldwide"]).map((c) => ({
          label: c,
          kind: "abroad" as const,
        }))
      : []),
  ];
  const tasks: SearchTask[] = [];

  for (const portal of prefs.portals) {
    for (const q of queries) {
      for (const place of places) {
        const url = searchUrl(portal, q, place);
        if (url) tasks.push({ portal, query: q, location: place.label, url });
      }
    }
  }
  return tasks;
}

function searchUrl(portal: Portal, q: string, place: { label: string; kind: "city" | "remote" | "abroad" }): string | null {
  switch (portal) {
    case "linkedin": {
      const base = `https://www.linkedin.com/jobs/search/?keywords=${enc(q)}&f_TPR=r86400`;
      if (place.kind === "remote") return `${base}&location=India&f_WT=2`;
      return `${base}&location=${enc(place.label)}`;
    }
    case "naukri": {
      if (place.kind === "abroad") return null; // Naukri is India-focused
      if (place.kind === "remote") return `https://www.naukri.com/${slug(q)}-jobs?k=${enc(q)}&wfhType=2&jobAge=1`;
      return `https://www.naukri.com/${slug(q)}-jobs-in-${slug(place.label)}?k=${enc(q)}&l=${enc(place.label)}&jobAge=1`;
    }
    case "indeed": {
      if (place.kind === "abroad") return null; // country sites differ; LinkedIn covers abroad
      const l = place.kind === "remote" ? "Remote" : place.label;
      return `https://in.indeed.com/jobs?q=${enc(q)}&l=${enc(l)}&fromage=1`;
    }
    default:
      return null;
  }
}
