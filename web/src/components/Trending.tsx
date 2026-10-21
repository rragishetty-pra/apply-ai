import Link from "next/link";
import type { TodayStats, TopSearch, TickerJob } from "@/lib/stats";

const PORTAL: Record<string, string> = { naukri: "Naukri", linkedin: "LinkedIn", indeed: "Indeed", other: "Other" };

/** Clicking a role starts sign-in / sign-up with that role carried through to onboarding. */
export const huntHref = (role: string) => `/login?role=${encodeURIComponent(role)}`;

function Chevron() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Today's top 3 searched roles — each one a way in. */
export function TopSearches({ stats }: { stats: TodayStats }) {
  return (
    <div className="card p-3 sm:p-4 shadow-[0_24px_60px_-30px_rgba(29,29,31,0.25)]">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-3 pb-4">
        <p className="font-semibold">{stats.usesSamples ? "Roles people hunt for" : "Most-searched roles today"}</p>
        {stats.freshToday > 0 && (
          <p className="text-sm text-muted">{stats.freshToday.toLocaleString("en-IN")} fresh jobs today</p>
        )}
      </div>

      <ol className="space-y-1">
        {stats.top.map((t, i) => (
          <RoleRow key={t.role} t={t} rank={i + 1} />
        ))}
      </ol>

      {stats.portals.length > 0 && (
        <div className="px-4 pt-4 flex flex-wrap gap-2">
          {stats.portals.map((p) => (
            <span key={p.portal} className="chip bg-mist text-muted">
              {PORTAL[p.portal] || p.portal} <b className="text-ink">{p.count}</b>
            </span>
          ))}
        </div>
      )}
      <p className="px-4 pt-4 pb-2 text-xs text-muted">
        {stats.usesSamples
          ? "Pick a role to start your own hunt. Live counts show up once enough people search the same role."
          : "Pick a role to start your own hunt."}
      </p>
    </div>
  );
}

function RoleRow({ t, rank }: { t: TopSearch; rank: number }) {
  return (
    <li>
      <Link
        href={huntHref(t.role)}
        className="group flex items-center gap-4 rounded-[20px] px-4 py-4 transition-colors hover:bg-mist"
      >
        <span className="h-11 w-11 shrink-0 grid place-items-center rounded-full bg-mist group-hover:bg-card text-lg font-bold tabular-nums transition-colors">
          {rank}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-lg font-semibold leading-snug truncate">{t.role}</span>
          <span className="block text-sm text-muted">
            {t.sample
              ? "Start hunting for this role"
              : `${t.hunters} people hunting${t.fresh ? `, ${t.fresh} new today` : ""}`}
          </span>
        </span>
        <span className="text-muted group-hover:text-ink transition-colors">
          <Chevron />
        </span>
      </Link>
    </li>
  );
}

/**
 * Fresh jobs found today across all portals. Every item is a real posting and opens it on the
 * portal (new tab), so people can apply straight away. Scrolls only when there are enough to loop.
 */
export function JobTicker({ jobs }: { jobs: TickerJob[] }) {
  if (!jobs.length) return null;
  const moving = jobs.length >= 6;
  const items = moving ? [...jobs, ...jobs] : jobs; // duplicated so the -50% translate loops seamlessly
  return (
    <div className={moving ? "ticker overflow-hidden" : ""} aria-label="Fresh jobs found today">
      <ul className={moving ? "ticker-track flex w-max gap-2.5 py-2 px-1" : "flex flex-wrap justify-center gap-2.5 py-2 px-4"}>
        {items.map((j, k) => {
          const clone = moving && k >= jobs.length;
          return (
            <li key={k} aria-hidden={clone || undefined}>
              <a
                href={j.url}
                target="_blank"
                rel="noopener noreferrer"
                tabIndex={clone ? -1 : undefined}
                title={`Open this job on ${PORTAL[j.portal || ""] || "the portal"}`}
                className="flex items-center gap-2 whitespace-nowrap rounded-full bg-card px-4 py-2 text-sm transition-colors hover:bg-ink hover:text-white"
              >
                <span className="font-semibold">{j.title}</span>
                {(j.company || j.location) && (
                  <span className="opacity-60">{[j.company, j.location].filter(Boolean).join(", ")}</span>
                )}
                {j.portal && <span className="opacity-60">on {PORTAL[j.portal] || j.portal}</span>}
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden className="opacity-50">
                  <path d="M14 5h5v5M19 5l-8 8M10 5H5v14h14v-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
