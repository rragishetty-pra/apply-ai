import type { TodayStats, TopSearch, TickerJob } from "@/lib/stats";

const PORTAL: Record<string, string> = { naukri: "Naukri", linkedin: "LinkedIn", indeed: "Indeed", other: "Other" };
const STICKER = [
  { bg: "bg-zest", tilt: "-rotate-[3deg]", shift: "" },
  { bg: "bg-ice", tilt: "rotate-[2deg]", shift: "sm:ml-10" },
  { bg: "bg-accent", tilt: "-rotate-[1.5deg]", shift: "sm:ml-4" },
];

/** Today's top 3 searched roles as stacked stickers. Ranked 1–3 because it is a ranking. */
export function TopSearches({ stats }: { stats: TodayStats }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-5 text-white">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-tangerine opacity-75 motion-safe:animate-ping" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-tangerine" />
        </span>
        <p className="font-bold">{stats.usesSamples ? "Roles people hunt for" : "Most-searched roles today"}</p>
        {stats.freshToday > 0 && (
          <p className="text-white/70 text-sm">{stats.freshToday.toLocaleString("en-IN")} fresh jobs found so far</p>
        )}
      </div>

      <ol className="space-y-4">
        {stats.top.map((t, i) => (
          <Sticker key={t.role} t={t} rank={i + 1} style={STICKER[i % 3]} />
        ))}
      </ol>

      {stats.portals.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2">
          {stats.portals.map((p) => (
            <span key={p.portal} className="chip bg-white/10 text-white border border-white/25 px-3 py-1">
              {PORTAL[p.portal] || p.portal} <b className="text-zest">{p.count}</b>
            </span>
          ))}
        </div>
      )}
      {stats.usesSamples && (
        <p className="mt-4 text-xs text-white/60">Live counts appear here once enough people search the same role. Until then, we show a random mix of roles.</p>
      )}
    </div>
  );
}

function Sticker({ t, rank, style }: { t: TopSearch; rank: number; style: (typeof STICKER)[number] }) {
  return (
    <li className={`${style.shift} max-w-md`}>
      <div className={`${style.bg} ${style.tilt} border-2 border-ink rounded-[26px] shadow-[6px_6px_0_var(--color-ink)] px-5 py-4 flex items-center gap-4 text-ink transition-transform hover:rotate-0`}>
        <span className="display text-5xl tabular-nums">{rank}</span>
        <div className="min-w-0">
          <p className="display text-2xl leading-tight truncate">{t.role}</p>
          <p className="text-sm font-medium mt-1">
            {t.sample
              ? "Start a hunt for this role"
              : `${t.hunters} people hunting${t.fresh ? `, ${t.fresh} new openings today` : ""}`}
          </p>
        </div>
      </div>
    </li>
  );
}

/** A scrolling band of fresh jobs across fields. The page's only ambient motion. */
export function JobTicker({ jobs, tone = "tangerine" }: { jobs: TickerJob[]; tone?: "tangerine" | "ink" }) {
  if (!jobs.length) return null;
  const loop = [...jobs, ...jobs]; // duplicated so the -50% translate loops seamlessly
  const band = tone === "tangerine" ? "bg-tangerine text-ink" : "bg-ink text-white";
  return (
    <div className={`ticker overflow-hidden border-y-2 border-ink ${band}`} aria-label="Fresh jobs found today">
      <ul className="ticker-track flex w-max gap-3 py-3 px-3">
        {loop.map((j, k) => (
          <li
            key={k}
            aria-hidden={k >= jobs.length}
            className="flex items-center gap-2 whitespace-nowrap rounded-full border-2 border-ink bg-white text-ink pl-3 pr-1.5 py-1"
          >
            <span className="font-bold">{j.title}</span>
            <span className="text-muted text-sm">
              {[j.company, j.location].filter(Boolean).join(", ")}
            </span>
            {j.portal && (
              <span className="chip bg-ink text-white">{PORTAL[j.portal] || j.portal}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
