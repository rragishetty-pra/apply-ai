import Link from "next/link";
import { Logo } from "@/components/Shell";

const AGENTS = [
  { name: "Hunter", status: "live", text: "Searches Naukri, LinkedIn and Indeed every day from your own signed-in Chrome and keeps only jobs that fit your field." },
  { name: "Tailor", status: "live", text: "Scores each job against your CV. At your match bar, it rewrites the right lines in your own CV file — same layout, no made-up skills." },
  { name: "Applier", status: "next", text: "Prepares an apply pack for each job and tells you whether a referral or a direct application is the better route." },
  { name: "Networker", status: "next", text: "Finds people at each company and drafts referral requests in your voice, for you to send." },
];

export default function Home() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto max-w-6xl px-4 h-16 flex items-center justify-between">
        <Logo />
        <Link href="/login" className="btn-ghost">Sign in</Link>
      </header>

      <section className="mx-auto max-w-6xl px-4 pt-14 pb-20 grid lg:grid-cols-[1.2fr_1fr] gap-12 items-center">
        <div>
          <p className="chip bg-accent-soft text-accent mb-5">Free beta</p>
          <h1 className="serif text-5xl sm:text-6xl leading-[1.05] mb-6">
            Your job search,<br />run by four quiet agents.
          </h1>
          <p className="text-lg text-muted max-w-xl mb-8">
            Upload your CV once and answer a few questions. Apply.ai finds fresh openings every day and hands you a CV
            tailored to each one — in your own format, ready to send.
          </p>
          <div className="flex gap-3">
            <Link href="/login" className="btn-primary px-6 py-3">Get started</Link>
            <a href="#how" className="btn-ghost px-6 py-3">How it works</a>
          </div>
        </div>

        <div className="card p-6 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.25)]">
          <p className="text-xs uppercase tracking-wider text-muted mb-4">Today</p>
          {[
            { t: "ETL Test Lead", c: "Fintech · Hyderabad", m: 86, s: "Tailored" },
            { t: "Senior Data QA Engineer", c: "Remote · India", m: 78, s: "Tailored" },
            { t: "Data Quality Manager", c: "Bengaluru", m: 64, s: "Stretch" },
          ].map((j) => (
            <div key={j.t} className="flex items-center justify-between py-3 border-b border-line last:border-0">
              <div>
                <p className="font-medium">{j.t}</p>
                <p className="text-sm text-muted">{j.c}</p>
              </div>
              <div className="text-right">
                <p className="serif text-2xl">{j.m}%</p>
                <p className={`text-xs ${j.s === "Tailored" ? "text-accent" : "text-amber"}`}>{j.s}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="how" className="border-t border-line bg-card">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="serif text-4xl mb-10">How it works</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {AGENTS.map((a, i) => (
              <div key={a.name} className="rounded-2xl border border-line p-5 bg-paper">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-muted">0{i + 1}</span>
                  <span className={`chip ${a.status === "live" ? "bg-accent-soft text-accent" : "bg-line/60 text-muted"}`}>
                    {a.status === "live" ? "Live" : "Coming next"}
                  </span>
                </div>
                <p className="serif text-2xl mb-2">{a.name}</p>
                <p className="text-sm text-muted leading-relaxed">{a.text}</p>
              </div>
            ))}
          </div>
          <div className="mt-12 grid sm:grid-cols-3 gap-6 text-sm">
            <p><b>Your passwords stay with you.</b> <span className="text-muted">Hunter works inside your own Chrome where you’re already signed in. We never ask for portal passwords.</span></p>
            <p><b>You stay in control.</b> <span className="text-muted">Nothing is submitted or sent without you. Apply.ai prepares; you decide.</span></p>
            <p><b>Honest CVs.</b> <span className="text-muted">Tailor only re-words what your CV already shows. It never adds skills, titles or dates.</span></p>
          </div>
        </div>
      </section>
    </div>
  );
}
