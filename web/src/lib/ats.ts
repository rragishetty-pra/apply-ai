/**
 * Company careers pages, via the public job APIs of the applicant-tracking systems most large
 * employers in India use. No scraping: each of these is the same feed the company's own careers
 * page loads. Pure parsing helpers are exported for tests.
 */

export type AtsKind = "workday" | "greenhouse" | "lever" | "smartrecruiters" | "ashby";

export interface AtsRef {
  ats: AtsKind;
  key: Record<string, string>; // workday: {host, tenant, site}; others: {token}
}

export interface AtsJob {
  id: string;
  title: string;
  location: string;
  url: string;
  postedDaysAgo: number | null;
  description?: string;
}

/** Find a supported ATS in a URL (careers link, job link, or anything on the careers page). */
export function detectAts(url: string): AtsRef | null {
  let m = url.match(/https?:\/\/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/i);
  if (m && !/^(wday|login|job)$/i.test(m[3])) return { ats: "workday", key: { host: `${m[1]}.${m[2]}.myworkdayjobs.com`, tenant: m[1], site: m[3] } };
  m = url.match(/(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([A-Za-z0-9_-]+)/i) || url.match(/greenhouse\.io\/embed\/job_board(?:\/js)?\?for=([A-Za-z0-9_-]+)/i);
  if (m && !/^(embed|v1)$/i.test(m[1])) return { ats: "greenhouse", key: { token: m[1] } };
  m = url.match(/jobs\.(eu\.)?lever\.co\/([A-Za-z0-9_.-]+)/i);
  if (m) return { ats: "lever", key: { token: m[2], region: m[1] ? "eu" : "" } };
  m = url.match(/(?:jobs|careers)\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/i);
  if (m && !/^(oneclick-ui|sr-jobs)$/i.test(m[1])) return { ats: "smartrecruiters", key: { token: m[1] } };
  m = url.match(/jobs\.ashbyhq\.com\/([A-Za-z0-9_.%-]+)/i);
  if (m) return { ats: "ashby", key: { token: decodeURIComponent(m[1]) } };
  return null;
}

/** Scan a page's HTML for links to a supported ATS. */
export function detectAtsInHtml(html: string): AtsRef | null {
  const urls = html.match(/https?:\/\/[^\s"'<>\\)]+/g) || [];
  for (const u of urls) {
    const r = detectAts(u.replace(/&amp;/g, "&"));
    if (r) return r;
  }
  return null;
}

/* ───────────────────────────── matching ───────────────────────────── */

const CITY_ALIASES: string[][] = [
  ["bengaluru", "bangalore"], ["gurugram", "gurgaon"], ["mumbai", "bombay", "navi mumbai", "thane"], ["chennai", "madras"],
  ["hyderabad", "secunderabad"], ["pune"], ["noida", "greater noida"], ["delhi", "new delhi", "ncr"], ["kolkata", "calcutta"],
  ["ahmedabad", "gandhinagar"], ["kochi", "cochin"], ["coimbatore"], ["thiruvananthapuram", "trivandrum"], ["chandigarh", "mohali"],
  ["jaipur"], ["indore"], ["mysuru", "mysore"], ["visakhapatnam", "vizag"], ["bhubaneswar"], ["nagpur"], ["vadodara"], ["lucknow"],
];
const INDIA = /india|\bin\b,|bengaluru|bangalore|hyderabad|pune|mumbai|chennai|gurugram|gurgaon|noida|delhi|kolkata|ahmedabad|kochi|coimbatore|trivandrum|thiruvananthapuram|chandigarh|jaipur|indore|mysuru|mysore|visakhapatnam|bhubaneswar|nagpur|vadodara|lucknow|secunderabad|telangana|karnataka|maharashtra|tamil nadu|haryana/i;

export function isIndia(location: string) {
  return INDIA.test(location || "");
}

/** Does a job's location suit the user? Cities they chose (with aliases), or remote in India. */
export function locationFits(location: string, cities: string[], remoteOk: boolean) {
  const loc = (location || "").toLowerCase();
  if (!isIndia(loc) && !/remote/.test(loc)) return false;
  if (!cities.length) return isIndia(loc) || remoteOk;
  for (const c of cities) {
    const group = CITY_ALIASES.find((g) => g.includes(c.toLowerCase().trim())) || [c.toLowerCase().trim()];
    if (group.some((a) => a && loc.includes(a))) return true;
  }
  const foreign = /(united states|usa|\bus\b|united kingdom|\buk\b|canada|europe|germany|singapore|australia|philippines|mexico|brazil)/;
  return remoteOk && /remote|work from home|anywhere/.test(loc) && (isIndia(loc) || !foreign.test(loc));
}

const STOP = new Set(["senior", "sr", "junior", "jr", "lead", "principal", "staff", "associate", "ii", "iii", "iv", "i", "the", "and", "of", "for", "a", "an", "-", "&", "manager", "specialist"]);

/** Core words of each target role, e.g. "Senior ETL Test Lead" → ["etl","test"]. */
export function roleCores(roles: string[]): string[][] {
  return roles
    .map((r) => r.toLowerCase().split(/[^a-z0-9+#.]+/).filter((w) => w && !STOP.has(w)))
    .filter((w) => w.length);
}

const stem = (w: string) => w.replace(/(ing|er|ers|s)$/,"");

/** A title matches if it contains every core word of some target role (loosely stemmed: test/tester/testing). */
export function titleMatches(title: string, cores: string[][]) {
  const words = new Set(title.toLowerCase().split(/[^a-z0-9+#.]+/).filter(Boolean).map(stem));
  return cores.some((core) => core.every((w) => words.has(stem(w))));
}

/** Search phrase for ATS keyword search, from the first target role. */
export const searchPhrase = (cores: string[][]) => (cores[0] || []).join(" ");

/** "Posted 3 Days Ago" / "Posted Today" / "Posted 30+ Days Ago" → days. */
export function workdayDays(postedOn: string | undefined): number | null {
  if (!postedOn) return null;
  if (/today/i.test(postedOn)) return 0;
  if (/yesterday/i.test(postedOn)) return 1;
  const m = postedOn.match(/(\d+)\+?\s*day/i);
  return m ? Number(m[1]) : null;
}

const daysSince = (d: string | number | undefined | null) => {
  if (d === undefined || d === null || d === "") return null;
  const t = typeof d === "number" ? d : Date.parse(d);
  return Number.isFinite(t) ? Math.floor((Date.now() - t) / 86400_000) : null;
};

export function htmlToText(html: string) {
  return html
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/<(br|\/p|\/li|\/h\d|\/div)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

/* ───────────────────────────── fetchers ───────────────────────────── */

const UA = { "User-Agent": "Mozilla/5.0 (compatible; ApplyAI-JobSearch/1.0)", Accept: "application/json" };

async function getJSON(url: string, init: RequestInit = {}, timeoutMs = 12_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, headers: { ...UA, ...(init.headers || {}) }, signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** Recent jobs at one company whose titles match the user's roles. */
export async function listJobs(ref: AtsRef, phrase: string, cores: string[][], maxDays = 7): Promise<AtsJob[]> {
  const fits = (j: AtsJob) => titleMatches(j.title, cores) && (j.postedDaysAgo === null || j.postedDaysAgo <= maxDays);
  const k = ref.key;

  switch (ref.ats) {
    case "workday": {
      const base = `https://${k.host}/wday/cxs/${k.tenant}/${k.site}`;
      const data = await getJSON(`${base}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: phrase }),
      });
      return (data.jobPostings || [])
        .map((p: { title: string; externalPath: string; locationsText?: string; postedOn?: string }) => ({
          id: p.externalPath,
          title: p.title,
          location: p.locationsText || "",
          url: `https://${k.host}/${k.site}${p.externalPath}`,
          postedDaysAgo: workdayDays(p.postedOn),
        }))
        .filter(fits);
    }
    case "greenhouse": {
      const data = await getJSON(`https://boards-api.greenhouse.io/v1/boards/${k.token}/jobs`);
      return (data.jobs || [])
        .map((j: { id: number; title: string; location?: { name?: string }; absolute_url: string; updated_at?: string; first_published?: string }) => ({
          id: String(j.id),
          title: j.title,
          location: j.location?.name || "",
          url: j.absolute_url,
          postedDaysAgo: daysSince(j.first_published || j.updated_at),
        }))
        .filter(fits);
    }
    case "lever": {
      const host = k.region === "eu" ? "api.eu.lever.co" : "api.lever.co";
      const data = await getJSON(`https://${host}/v0/postings/${k.token}?mode=json`);
      return (Array.isArray(data) ? data : [])
        .map((j: { id: string; text: string; hostedUrl: string; createdAt?: number; categories?: { location?: string; allLocations?: string[] }; descriptionPlain?: string; lists?: { text: string; content: string }[]; additionalPlain?: string }) => ({
          id: j.id,
          title: j.text,
          location: [j.categories?.location, ...(j.categories?.allLocations || [])].filter(Boolean).join(", "),
          url: j.hostedUrl,
          postedDaysAgo: daysSince(j.createdAt),
          description: [j.descriptionPlain, ...(j.lists || []).map((l) => `${l.text}\n${htmlToText(l.content)}`), j.additionalPlain].filter(Boolean).join("\n\n"),
        }))
        .filter(fits);
    }
    case "smartrecruiters": {
      const data = await getJSON(`https://api.smartrecruiters.com/v1/companies/${k.token}/postings?limit=100&country=in&q=${encodeURIComponent(phrase)}`);
      return (data.content || [])
        .map((j: { id: string; name: string; releasedDate?: string; location?: { city?: string; region?: string; country?: string; remote?: boolean } }) => ({
          id: j.id,
          title: j.name,
          location: [j.location?.city, j.location?.region, j.location?.country === "in" ? "India" : j.location?.country, j.location?.remote ? "Remote" : ""].filter(Boolean).join(", "),
          url: `https://jobs.smartrecruiters.com/${k.token}/${j.id}`,
          postedDaysAgo: daysSince(j.releasedDate),
        }))
        .filter(fits);
    }
    case "ashby": {
      const data = await getJSON(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(k.token)}?includeCompensation=false`);
      return (data.jobs || [])
        .filter((j: { isListed?: boolean }) => j.isListed !== false)
        .map((j: { id: string; title: string; location?: string; secondaryLocations?: { location: string }[]; isRemote?: boolean; jobUrl: string; publishedAt?: string; descriptionPlain?: string }) => ({
          id: j.id,
          title: j.title,
          location: [j.location, ...(j.secondaryLocations || []).map((x) => x.location), j.isRemote ? "Remote" : ""].filter(Boolean).join(", "),
          url: j.jobUrl,
          postedDaysAgo: daysSince(j.publishedAt),
          description: j.descriptionPlain,
        }))
        .filter(fits);
    }
  }
}

/** Full description (and the definitive location) for one job. */
export async function jobDetail(ref: AtsRef, job: AtsJob): Promise<{ description: string; location: string }> {
  if (job.description) return { description: job.description, location: job.location };
  const k = ref.key;
  switch (ref.ats) {
    case "workday": {
      const d = await getJSON(`https://${k.host}/wday/cxs/${k.tenant}/${k.site}${job.id}`);
      const info = d.jobPostingInfo || {};
      return {
        description: htmlToText(info.jobDescription || ""),
        location: [info.location, ...(info.additionalLocations || [])].filter(Boolean).join(", ") || job.location,
      };
    }
    case "greenhouse": {
      const d = await getJSON(`https://boards-api.greenhouse.io/v1/boards/${k.token}/jobs/${job.id}`);
      return { description: htmlToText(d.content || ""), location: d.location?.name || job.location };
    }
    case "smartrecruiters": {
      const d = await getJSON(`https://api.smartrecruiters.com/v1/companies/${k.token}/postings/${job.id}`);
      const sec = d.jobAd?.sections || {};
      const text = ["jobDescription", "qualifications", "additionalInformation"].map((x) => sec[x]?.text || "").join("\n");
      return { description: htmlToText(text), location: job.location };
    }
    default:
      return { description: job.description || "", location: job.location };
  }
}
