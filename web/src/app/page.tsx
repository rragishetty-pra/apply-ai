import Link from "next/link";
import { Logo } from "@/components/Shell";
import { JobTicker, TopSearches } from "@/components/Trending";
import { getTodayStats } from "@/lib/stats";

export const revalidate = 300; // landing stats refresh every 5 minutes

const AGENTS = [
  {
    name: "Hunter",
    live: true,
    text: "Checks Naukri, LinkedIn and Indeed every day from your own signed-in Chrome, and throws out jobs that aren't your thing.",
    color: "bg-zest",
  },
  {
    name: "Tailor",
    live: true,
    text: "Scores every job against your CV. When it's a real match, it rewrites the right lines in your own CV file. Same layout, zero made-up skills.",
    color: "bg-accent",
  },
  {
    name: "Applier",
    live: false,
    text: "Packs everything you need to apply and tells you if a referral beats applying cold.",
    color: "bg-ice",
  },
  {
    name: "Networker",
    live: false,
    text: "Finds people at the company and drafts referral asks that sound like you, ready for you to send.",
    color: "bg-tangerine",
  },
];

export default async function Home() {
  const stats = await getTodayStats();

  return (
    <div className="min-h-screen">
      {/* Stage */}
      <section className="bg-grape text-white relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.18]"
          style={{ backgroundImage: "radial-gradient(circle, #ffffff 1.2px, transparent 1.4px)", backgroundSize: "22px 22px" }}
        />
        <header className="relative mx-auto max-w-6xl px-4 h-20 flex items-center justify-between">
          <Logo light />
          <Link href="/login" className="btn bg-white text-ink">Sign in</Link>
        </header>

        <div className="relative mx-auto max-w-6xl px-4 pt-8 pb-16 lg:pb-24 grid lg:grid-cols-[1.15fr_1fr] gap-14 items-center">
          <div>
            <h1 className="display text-[clamp(3rem,6.2vw,5.4rem)] mb-7">
              Job hunting, minus the doomscrolling.
            </h1>
            <p className="text-lg sm:text-xl text-white/85 max-w-xl mb-9 leading-relaxed">
              Drop your CV once. Apply.ai searches the big job portals every day from your own Chrome and hands you a CV
              tailored to every job that&apos;s actually worth your time.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/login" className="btn-accent px-7 py-3.5 text-base">Start free</Link>
              <a href="#how" className="btn bg-transparent text-white border-white shadow-[3px_3px_0_#ffffff] hover:shadow-[4px_4px_0_#ffffff] px-7 py-3.5 text-base">
                See how it works
              </a>
            </div>
            <p className="mt-6 text-sm text-white/60">Free while in beta. No portal passwords, ever.</p>
          </div>

          <TopSearches stats={stats} />
        </div>
      </section>

      <JobTicker jobs={stats.ticker} />

      {/* Pipeline */}
      <section id="how" className="mx-auto max-w-6xl px-4 py-20">
        <h2 className="display text-5xl sm:text-6xl max-w-2xl mb-4">Four agents. One relay.</h2>
        <p className="text-lg text-muted max-w-xl mb-12">
          Each one finishes its job and passes the baton. You only step in to hit send.
        </p>

        <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {AGENTS.map((a, i) => (
            <li key={a.name} className={`card p-6 flex flex-col ${a.live ? "" : "bg-card/70"}`}>
              <div className="flex items-center justify-between mb-6">
                <span className={`${a.color} border-2 border-ink rounded-2xl h-12 w-12 grid place-items-center display text-2xl`}>
                  {i + 1}
                </span>
                <span className={`chip border-2 border-ink ${a.live ? "bg-accent text-ink" : "bg-white text-muted"}`}>
                  {a.live ? "Live now" : "Up next"}
                </span>
              </div>
              <h3 className="display text-3xl mb-3">{a.name}</h3>
              <p className="text-muted leading-relaxed">{a.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Promises */}
      <section className="bg-ink text-white">
        <div className="mx-auto max-w-6xl px-4 py-16 grid md:grid-cols-3 gap-10">
          {[
            ["Your passwords stay yours.", "Hunter works inside the Chrome you're already signed in to. We never ask for portal logins."],
            ["Nothing goes out without you.", "Apply.ai lines everything up. You decide what gets sent, and when."],
            ["No fake flexing.", "Tailor only rewords what your CV already shows. It never adds skills, titles or dates."],
          ].map(([h, p]) => (
            <div key={h}>
              <p className="display text-3xl mb-3 text-zest">{h}</p>
              <p className="text-white/75 leading-relaxed">{p}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-4 py-10 flex flex-wrap items-center justify-between gap-4">
        <Logo />
        <Link href="/login" className="btn-primary">Start free</Link>
      </footer>
    </div>
  );
}
