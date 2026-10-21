import Link from "next/link";
import { Logo } from "@/components/Shell";
import { JobTicker, TopSearches } from "@/components/Trending";
import { getTodayStats } from "@/lib/stats";

export const revalidate = 300; // landing stats refresh every 5 minutes

const AGENTS = [
  { name: "Hunter", live: true, text: "Checks Naukri, LinkedIn and Indeed every day from your own signed-in Chrome, and drops jobs that aren't your thing." },
  { name: "Tailor", live: true, text: "Scores each job against your CV. For real matches, it rewrites the right lines in your own CV file. Same layout, nothing made up." },
  { name: "Applier", live: false, text: "Gets everything ready to apply and tells you when a referral beats applying cold." },
  { name: "Networker", live: false, text: "Finds people at the company and drafts referral asks that sound like you." },
];

export default async function Home() {
  const stats = await getTodayStats();

  return (
    <div className="min-h-screen">
      <header className="mx-auto max-w-6xl px-5 h-20 flex items-center justify-between">
        <Logo />
        <Link href="/login" className="btn-ghost">Sign in</Link>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-5 pt-10 pb-16 lg:pt-16 lg:pb-24 grid lg:grid-cols-[1.1fr_1fr] gap-12 lg:gap-16 items-center">
        <div>
          <h1 className="display text-[clamp(2.75rem,5.6vw,4.75rem)] mb-6 max-w-[14ch]">
            Job hunting, minus the doomscrolling.
          </h1>
          <p className="text-lg text-muted max-w-[46ch] mb-9 leading-relaxed">
            Drop your CV once. Apply.ai searches the big job portals every day from your own Chrome and hands you a CV
            tailored to every job that&apos;s worth your time.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/login" className="btn-primary px-7 py-3.5 text-base">Start free</Link>
            <a href="#how" className="btn px-5 py-3.5 text-base text-muted hover:text-ink">How it works</a>
          </div>
          <p className="mt-8 text-sm text-muted">Free during the beta. We never ask for your portal passwords.</p>
        </div>

        <TopSearches stats={stats} />
      </section>

      {stats.ticker.length > 0 && (
        <section className="bg-mist py-4" aria-labelledby="fresh">
          <p id="fresh" className="mx-auto max-w-6xl px-5 pb-2 text-sm font-semibold text-muted">
            Fresh today. Click any job to open it on the portal.
          </p>
          <JobTicker jobs={stats.ticker} />
        </section>
      )}

      {/* How it works: a real sequence, so it's numbered */}
      <section id="how" className="mx-auto max-w-6xl px-5 py-20 lg:py-28">
        <h2 className="display text-4xl sm:text-5xl max-w-[18ch] mb-4">Four agents, one relay.</h2>
        <p className="text-lg text-muted max-w-[48ch] mb-14">
          Each one finishes its part and passes the baton. You only step in to hit send.
        </p>

        <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-10 gap-y-12">
          {AGENTS.map((a, i) => (
            <li key={a.name}>
              <div className="flex items-center gap-3 mb-5">
                <span className={`h-10 w-10 rounded-full grid place-items-center font-bold ${a.live ? "bg-ink text-white" : "bg-mist text-muted"}`}>
                  {i + 1}
                </span>
                <span className={`chip ${a.live ? "bg-accent-soft text-accent" : "bg-mist text-muted"}`}>
                  {a.live ? "Live" : "Coming next"}
                </span>
              </div>
              <h3 className="text-2xl font-bold tracking-tight mb-2">{a.name}</h3>
              <p className="text-muted leading-relaxed">{a.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Promises */}
      <section className="mx-auto max-w-6xl px-5 pb-24">
        <div className="card px-8 py-12 sm:px-12 grid md:grid-cols-3 gap-10">
          {[
            ["Your passwords stay yours", "Hunter works inside the Chrome you're already signed in to. We never ask for portal logins."],
            ["Nothing goes out without you", "Apply.ai gets things ready. You decide what gets sent, and when."],
            ["Honest CVs only", "Tailor rewords what your CV already shows. It never adds skills, titles or dates."],
          ].map(([h, p]) => (
            <div key={h}>
              <p className="text-xl font-bold tracking-tight mb-2">{h}</p>
              <p className="text-muted leading-relaxed">{p}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-5 pb-12 flex flex-wrap items-center justify-between gap-4">
        <Logo />
        <Link href="/login" className="btn-primary">Start free</Link>
      </footer>
    </div>
  );
}
