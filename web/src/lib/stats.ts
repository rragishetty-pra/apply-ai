import "server-only";
import { supabaseAdmin } from "./supabase-admin";

/**
 * "Today on Apply.ai" — aggregate, privacy-safe numbers for the landing page and dashboard.
 * - A searched role is only shown once at least MIN_HUNTERS people search it.
 * - The ticker takes at most PER_USER jobs from any one person, and one job per role family,
 *   so it never reveals a single user's hunt and never sticks to one field.
 * - Gaps are filled from a varied sample pool, flagged as samples.
 */

export interface TopSearch {
  role: string;
  hunters: number | null;   // people searching this role (null for samples)
  fresh: number | null;     // jobs found today matching it (null for samples)
  sample: boolean;
}

export interface TickerJob {
  title: string;
  company: string | null;
  location: string | null;
  portal: string | null;
  sample: boolean;
}

export interface TodayStats {
  top: TopSearch[];
  ticker: TickerJob[];
  portals: { portal: string; count: number }[];
  freshToday: number;
  hunters: number;
  updatedAt: string;
  usesSamples: boolean;
}

const MIN_HUNTERS = 2;
const PER_USER = 3;

const SAMPLE_ROLES = [
  "Product Designer", "Data Analyst", "Frontend Developer", "Growth Marketer", "Backend Engineer",
  "Business Analyst", "Content Strategist", "DevOps Engineer", "Product Manager", "HR Business Partner",
  "Financial Analyst", "Customer Success Manager", "Android Developer", "ETL Test Lead", "Data Engineer",
  "UX Researcher", "Sales Development Rep", "Cloud Architect", "QA Automation Engineer", "Brand Designer",
  "Machine Learning Engineer", "Social Media Manager", "Supply Chain Analyst", "Full Stack Developer",
];
const SAMPLE_CITIES = ["Bengaluru", "Hyderabad", "Pune", "Mumbai", "Gurugram", "Chennai", "Remote", "Noida", "Kochi"];
const SAMPLE_PORTALS = ["naukri", "linkedin", "indeed"];

function shuffle<T>(a: T[]): T[] {
  const arr = [...a];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+ ]/g, " ").replace(/\s+/g, " ").trim();
/** Rough "role family": drop seniority words so "Sr Data Analyst" and "Data Analyst II" group together. */
const family = (title: string) =>
  norm(title)
    .split(" ")
    .filter((w) => !/^(senior|sr|junior|jr|lead|principal|staff|associate|ii|iii|iv|i|head|chief|trainee|intern|remote|hybrid)$/.test(w))
    .slice(0, 3)
    .join(" ");

/** Midnight today in India (UTC+5:30), as an ISO string. */
function startOfTodayIST(): string {
  const ist = new Date(Date.now() + 5.5 * 3600_000);
  ist.setUTCHours(0, 0, 0, 0);
  return new Date(ist.getTime() - 5.5 * 3600_000).toISOString();
}

function samples(nTop: number, nTicker: number, taken: Set<string>) {
  const roles = shuffle(SAMPLE_ROLES).filter((r) => !taken.has(family(r)));
  const top: TopSearch[] = roles.slice(0, nTop).map((role) => ({ role, hunters: null, fresh: null, sample: true }));
  const ticker: TickerJob[] = roles.slice(nTop, nTop + nTicker).map((title) => ({
    title,
    company: null,
    location: SAMPLE_CITIES[Math.floor(Math.random() * SAMPLE_CITIES.length)],
    portal: SAMPLE_PORTALS[Math.floor(Math.random() * SAMPLE_PORTALS.length)],
    sample: true,
  }));
  return { top, ticker };
}

export async function getTodayStats(): Promise<TodayStats> {
  const since = startOfTodayIST();
  let top: TopSearch[] = [];
  let ticker: TickerJob[] = [];
  let portals: { portal: string; count: number }[] = [];
  let freshToday = 0;
  let hunters = 0;

  try {
    const db = supabaseAdmin();
    const [{ data: profiles }, { data: jobs }] = await Promise.all([
      db.from("profiles").select("id, prefs").eq("onboarded", true).limit(5000),
      db
        .from("jobs")
        .select("user_id, title, company, location, portal, status")
        .gte("created_at", since)
        .neq("status", "skipped")
        .order("created_at", { ascending: false })
        .limit(3000),
    ]);

    // Roles people are searching (from their saved answers)
    const roleUsers = new Map<string, { label: string; users: Set<string> }>();
    for (const p of profiles || []) {
      const roles: string[] = Array.isArray(p.prefs?.target_roles) ? p.prefs.target_roles : [];
      for (const r of roles.slice(0, 3)) {
        const key = family(r);
        if (!key) continue;
        const entry = roleUsers.get(key) || { label: r.trim(), users: new Set<string>() };
        entry.users.add(p.id);
        roleUsers.set(key, entry);
      }
    }
    hunters = (profiles || []).length;

    const todays = jobs || [];
    freshToday = todays.length;

    const portalCount = new Map<string, number>();
    for (const j of todays) portalCount.set(j.portal, (portalCount.get(j.portal) || 0) + 1);
    portals = [...portalCount.entries()].map(([portal, count]) => ({ portal, count })).sort((a, b) => b.count - a.count);

    top = [...roleUsers.entries()]
      .filter(([, v]) => v.users.size >= MIN_HUNTERS)
      .map(([key, v]) => ({
        role: v.label,
        hunters: v.users.size,
        fresh: todays.filter((j) => {
          const words = new Set(norm(j.title || "").split(" "));
          return key.split(" ").every((w) => words.has(w));
        }).length,
        sample: false,
      }))
      .sort((a, b) => b.hunters! - a.hunters! || b.fresh! - a.fresh!)
      .slice(0, 3);

    // Ticker: one job per role family, at most PER_USER per person, shuffled.
    const perUser = new Map<string, number>();
    const seenFamilies = new Set<string>();
    for (const j of shuffle(todays)) {
      if (!j.title) continue;
      const f = family(j.title);
      if (!f || seenFamilies.has(f)) continue;
      const n = perUser.get(j.user_id) || 0;
      if (n >= PER_USER) continue;
      perUser.set(j.user_id, n + 1);
      seenFamilies.add(f);
      ticker.push({ title: j.title, company: j.company, location: j.location, portal: j.portal, sample: false });
      if (ticker.length >= 14) break;
    }
  } catch {
    // No database (e.g. during a build) → samples only
  }

  const taken = new Set([...top.map((t) => family(t.role)), ...ticker.map((t) => family(t.title))]);
  const fill = samples(3 - top.length, Math.max(0, 12 - ticker.length), taken);
  const usesSamples = fill.top.length > 0 || fill.ticker.length > 0;

  return {
    top: [...top, ...fill.top],
    ticker: shuffle([...ticker, ...fill.ticker]),
    portals,
    freshToday,
    hunters,
    updatedAt: new Date().toISOString(),
    usesSamples,
  };
}
