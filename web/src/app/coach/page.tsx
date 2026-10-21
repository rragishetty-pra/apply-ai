"use client";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/supabase-browser";
import { useAuth } from "@/components/useAuth";
import Shell from "@/components/Shell";
import { ask, useExtension } from "@/components/ExtensionConnect";
import type { CoachMessage, CoachSession, InterviewPrep, Job, UpskillPlan } from "@/lib/types";

const searchUrl = (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;
type Mode = "interview" | "upskill";

function CoachInner() {
  const { session } = useAuth();
  const params = useSearchParams();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sessions, setSessions] = useState<CoachSession[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(params.get("skill") || params.get("mode") === "upskill" ? "upskill" : "interview");
  const [jobId, setJobId] = useState(params.get("job") || "");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [when, setWhen] = useState("");
  const [notes, setNotes] = useState("");
  const [skills, setSkills] = useState(params.get("skill") || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ jobs }, { sessions }] = await Promise.all([
      api<{ jobs: Job[] }>("/api/jobs"),
      api<{ sessions: CoachSession[] }>("/api/coach"),
    ]);
    setJobs(jobs);
    setSessions(sessions);
    return sessions;
  }, []);

  useEffect(() => {
    if (!session) return;
    load()
      .then((ss) => {
        if (!params.get("job") && !params.get("skill") && ss[0]) setOpenId(ss[0].id);
      })
      .catch((e) => setErr((e as Error).message));
  }, [session, load, params]);

  const job = jobs.find((j) => j.id === jobId) || null;
  useEffect(() => {
    if (job) setWhen((w) => w || job.interview_at || "");
  }, [job]);

  // Jobs worth preparing for: interviews first, then applied, then tailored, then potential.
  const pickable = useMemo(() => {
    const rank = (j: Job) => (j.stage === "interview" ? 0 : j.applied ? 1 : j.status === "tailored" ? 2 : j.status === "stretch" ? 3 : 4);
    return jobs.filter((j) => rank(j) < 4).sort((a, b) => rank(a) - rank(b));
  }, [jobs]);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const body =
        mode === "interview"
          ? { kind: "interview", job_id: jobId || undefined, company, role, interview_at: when, notes }
          : { kind: "upskill", job_id: jobId || undefined, skills, role };
      const { session: s } = await api<{ session: CoachSession }>("/api/coach", { method: "POST", body: JSON.stringify(body) });
      await load();
      setOpenId(s.id);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await api(`/api/coach/${id}`, { method: "DELETE" });
    if (openId === id) setOpenId(null);
    load();
  }

  const open = sessions?.find((x) => x.id === openId) || null;

  return (
    <Shell>
      <div className="mb-8 max-w-2xl">
        <h1 className="display text-4xl sm:text-5xl mb-3">Coach</h1>
        <p className="text-muted leading-relaxed">
          Got an interview? Coach reads what other candidates shared about that company and role, then builds your prep
          around your own CV. Want to grow into a job? Get a learning plan.
        </p>
      </div>

      <div className="grid lg:grid-cols-[380px_1fr] gap-6 items-start">
        {/* Start */}
        <div className="space-y-6">
          <form onSubmit={start} className="card p-6 space-y-4">
            <div className="grid grid-cols-2 gap-1 rounded-full bg-mist p-1" role="tablist">
              {(["interview", "upskill"] as Mode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => setMode(m)}
                  className={`rounded-full py-2 text-sm font-semibold transition-colors ${mode === m ? "bg-card shadow-sm" : "text-muted hover:text-ink"}`}
                >
                  {m === "interview" ? "Interview prep" : "Upskill plan"}
                </button>
              ))}
            </div>

            <div>
              <label className="label" htmlFor="c-job">{mode === "interview" ? "Which job?" : "For a job (optional)"}</label>
              <select id="c-job" className="input" value={jobId} onChange={(e) => setJobId(e.target.value)}>
                <option value="">{mode === "interview" ? "Not in my list, I'll type it" : "No specific job"}</option>
                {pickable.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.stage === "interview" ? "Interview: " : j.status === "stretch" ? "Potential: " : ""}
                    {j.title} at {j.company}
                  </option>
                ))}
              </select>
            </div>

            {mode === "interview" ? (
              <>
                {!jobId && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label" htmlFor="c-company">Company</label>
                      <input id="c-company" className="input" required value={company} onChange={(e) => setCompany(e.target.value)} />
                    </div>
                    <div>
                      <label className="label" htmlFor="c-role">Role</label>
                      <input id="c-role" className="input" required value={role} onChange={(e) => setRole(e.target.value)} />
                    </div>
                  </div>
                )}
                <div>
                  <label className="label" htmlFor="c-when">Interview date</label>
                  <input id="c-when" className="input" placeholder="e.g. 28 Oct, 11 AM" value={when} onChange={(e) => setWhen(e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="c-notes">What did the recruiter tell you?</label>
                  <textarea id="c-notes" className="input min-h-20" value={notes} onChange={(e) => setNotes(e.target.value)}
                    placeholder="Round names, who you'll meet, topics they mentioned…" />
                </div>
                <button className="btn-primary w-full" disabled={busy}>
                  {busy ? "Reading interview experiences…" : "Build my interview prep"}
                </button>
              </>
            ) : (
              <>
                <div>
                  <label className="label" htmlFor="c-skills">Skills or tools to learn</label>
                  <input id="c-skills" className="input" value={skills} onChange={(e) => setSkills(e.target.value)}
                    placeholder={job ? "Leave empty to use this job's gaps" : "e.g. Snowflake, Python"} />
                </div>
                {!jobId && (
                  <div>
                    <label className="label" htmlFor="c-target">Role you're aiming for (optional)</label>
                    <input id="c-target" className="input" value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Data Engineer" />
                  </div>
                )}
                <button className="btn-primary w-full" disabled={busy}>{busy ? "Making your plan…" : "Make my learning plan"}</button>
              </>
            )}
            {busy && <p className="text-xs text-muted">This usually takes 20–40 seconds. Coach is searching the web as it works.</p>}
            {err && <p className="text-sm text-rose">{err}</p>}
          </form>

          <div className="card p-4">
            <p className="font-bold px-2 pt-1 pb-3">Your sessions</p>
            {sessions === null ? (
              <p className="text-sm text-muted px-2 pb-2">Loading…</p>
            ) : sessions.length === 0 ? (
              <p className="text-sm text-muted px-2 pb-2">Nothing yet. Start one above.</p>
            ) : (
              <ul className="space-y-1">
                {sessions.map((x) => (
                  <li key={x.id}>
                    <button
                      onClick={() => setOpenId(x.id)}
                      className={`w-full text-left rounded-2xl px-3 py-2.5 transition-colors ${openId === x.id ? "bg-ink text-white" : "hover:bg-mist"}`}
                    >
                      <span className="block font-semibold text-sm truncate">{x.title}</span>
                      <span className={`block text-xs ${openId === x.id ? "text-white/60" : "text-muted"}`}>
                        {x.kind === "interview" ? "Interview prep" : "Upskill plan"}, {new Date(x.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Result */}
        <div>
          {open ? (
            <SessionView
              key={open.id}
              s={open}
              onDelete={() => remove(open.id)}
              onChange={(ns) => setSessions((all) => (all || []).map((x) => (x.id === ns.id ? ns : x)))}
              onReload={load}
            />
          ) : (
            <div className="card p-10 text-center text-muted">Pick a session, or start a new one.</div>
          )}
        </div>
      </div>
    </Shell>
  );
}

export default function CoachPage() {
  return (
    <Suspense>
      <CoachInner />
    </Suspense>
  );
}

/* ───────────────────────────── Views ───────────────────────────── */

function SessionView({
  s,
  onDelete,
  onChange,
  onReload,
}: {
  s: CoachSession;
  onDelete: () => void;
  onChange: (s: CoachSession) => void;
  onReload: () => Promise<CoachSession[]>;
}) {
  return (
    <article className="space-y-5">
      <div className="card p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">{s.title}</h2>
          <div className="flex gap-2 print:hidden">
            <button className="btn-ghost py-1.5" onClick={() => window.print()}>Print</button>
            <button className="btn-ghost py-1.5" onClick={onDelete}>Delete</button>
          </div>
        </div>
        {s.kind === "interview" && <ResearchBar s={s} onReload={onReload} />}
        {s.result && s.kind === "interview" && <InterviewView r={s.result as InterviewPrep} />}
        {s.result && s.kind === "upskill" && <UpskillView r={s.result as UpskillPlan} />}
      </div>
      <AskCoach s={s} onChange={onChange} />
      <Sources s={s} />
    </article>
  );
}

/* Deeper research: read full reviews on Glassdoor / AmbitionBox in the user's own Chrome. */
function ResearchBar({ s, onReload }: { s: CoachSession; onReload: () => Promise<CoachSession[]> }) {
  const extension = useExtension();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const input = s.input as { company?: string; role?: string };

  async function go() {
    setBusy(true);
    setMsg("Opening Glassdoor and AmbitionBox in a background window and reading interview reviews. This takes 1–3 minutes…");
    try {
      const r = await ask<{ found: number; login_needed: string[]; sites: string[] }>(
        "RESEARCH_INTERVIEWS",
        { sessionId: s.id, company: input.company, role: input.role },
        300_000
      );
      if (r.found) {
        await onReload();
        setMsg(
          `Read ${r.found} interview review${r.found > 1 ? "s" : ""} from ${r.sites.join(" and ")}. Your prep has been rebuilt around them.` +
            (r.login_needed.length ? ` Sign in to ${r.login_needed.join(" and ")} in Chrome to read even more.` : "")
        );
      } else if (r.login_needed.length) {
        setMsg(`${r.login_needed.join(" and ")} asked you to sign in. Sign in there in this Chrome, then try again.`);
      } else {
        setMsg(`Couldn't find interview reviews for ${input.company} on Glassdoor or AmbitionBox. The prep below uses what Coach found through search.`);
      }
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 mb-2 rounded-2xl bg-paper px-5 py-4 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm max-w-xl">
          {s.research_at && s.research?.length ? (
            <>
              Includes {s.research.reduce((n, x) => n + x.count, 0)} reviews read from{" "}
              {s.research.map((x) => x.site).join(" and ")} on{" "}
              {new Date(s.research_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}.
            </>
          ) : (
            <>Go deeper: read the full interview reviews on Glassdoor and AmbitionBox in your own Chrome, where you&apos;re signed in.</>
          )}
        </p>
        {extension ? (
          <button className="btn-primary py-2" disabled={busy} onClick={go}>
            {busy ? "Reading reviews…" : s.research_at ? "Read again" : "Read full reviews"}
          </button>
        ) : (
          <a className="btn-ghost py-2" href="/settings">Connect the Chrome extension</a>
        )}
      </div>
      {msg && <p className="text-xs text-muted mt-2">{msg}</p>}
    </div>
  );
}

/* Ask Coach: follow-ups, deeper dives, mock interview. */
const SUGGEST: Record<CoachSession["kind"], string[]> = {
  interview: [
    "Quiz me: ask me one question at a time and score my answers",
    "Find more technical questions for this role",
    "How should I answer “Tell me about yourself” for this job?",
    "My interview moved to tomorrow. Adjust the plan.",
  ],
  upskill: [
    "I only have 3 hours a week. Adjust the plan.",
    "Which certification here do employers value most?",
    "Explain the first topic like I'm starting from zero",
    "Give me a project idea that uses my current domain",
  ],
};

function Rich({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) out.push(<ul key={out.length} className="list-disc pl-5 space-y-1 my-1">{bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>);
    bullets = [];
  };
  for (const l of lines) {
    const t = l.trim();
    if (/^[-*•]\s+/.test(t)) bullets.push(t.replace(/^[-*•]\s+/, ""));
    else {
      flush();
      if (t) out.push(<p key={out.length} className="my-1">{t}</p>);
    }
  }
  flush();
  return <>{out}</>;
}

function AskCoach({ s, onChange }: { s: CoachSession; onChange: (s: CoachSession) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const messages: CoachMessage[] = s.messages || [];

  useEffect(() => {
    if (messages.length || pending) endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages.length, pending]);

  async function send(msg: string) {
    const m = msg.trim();
    if (!m || busy) return;
    setBusy(true);
    setErr(null);
    setPending(m);
    setText("");
    try {
      const { session } = await api<{ session: CoachSession }>(`/api/coach/${s.id}/chat`, { method: "POST", body: JSON.stringify({ message: m }) });
      onChange(session);
    } catch (e) {
      setErr((e as Error).message);
      setText(m);
    } finally {
      setPending(null);
      setBusy(false);
    }
  }

  return (
    <section className="card p-6 sm:p-8 print:hidden" aria-label="Ask Coach">
      <p className="text-xl font-bold tracking-tight mb-1">Ask Coach</p>
      <p className="text-sm text-muted mb-5">
        Go deeper on anything above, practise with a mock interview, or tell Coach what changed. New questions and plan changes are saved into your prep.
      </p>

      {(messages.length > 0 || pending) && (
        <div className="space-y-3 mb-5 max-h-[560px] overflow-y-auto pr-1">
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
              <div className={`rounded-[22px] px-4 py-3 text-[15px] leading-relaxed max-w-[85%] ${m.role === "user" ? "bg-ink text-white" : "bg-paper"}`}>
                {m.role === "coach" ? <Rich text={m.text} /> : m.text}
                {m.added && <p className="text-xs text-accent font-semibold mt-2">Saved: {m.added}</p>}
              </div>
            </div>
          ))}
          {pending && (
            <>
              <div className="flex justify-end">
                <div className="rounded-[22px] px-4 py-3 text-[15px] bg-ink text-white max-w-[85%]">{pending}</div>
              </div>
              <div className="rounded-[22px] px-4 py-3 bg-paper text-muted text-sm w-fit">Coach is thinking and searching…</div>
            </>
          )}
          <div ref={endRef} />
        </div>
      )}

      {messages.length === 0 && !pending && (
        <div className="flex flex-wrap gap-2 mb-4">
          {SUGGEST[s.kind].map((q) => (
            <button key={q} onClick={() => send(q)} disabled={busy} className="rounded-full bg-mist hover:bg-ink hover:text-white px-4 py-2 text-sm text-left transition-colors">
              {q}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
        className="flex gap-2 items-end"
      >
        <textarea
          className="input min-h-[52px] max-h-40 resize-y"
          rows={1}
          placeholder={messages.some((m) => /score|quiz/i.test(m.text)) ? "Type your answer…" : "Ask Coach anything about this…"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(text);
            }
          }}
        />
        <button className="btn-primary h-[52px] px-6" disabled={busy || !text.trim()}>{busy ? "…" : "Send"}</button>
      </form>
      {err && <p className="text-sm text-rose mt-2">{err}</p>}
    </section>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="pt-6 mt-6 border-t border-line">
      <h3 className="text-lg font-bold mb-3">{title}</h3>
      {children}
    </section>
  );
}

function InterviewView({ r }: { r: InterviewPrep }) {
  return (
    <div>
      <p className="text-muted leading-relaxed max-w-3xl">{r.overview}</p>
      {r.confidence_note && <p className="text-xs text-muted mt-3">{r.confidence_note}</p>}

      {!!r.rounds?.length && (
        <Block title="How the interview usually runs">
          <ol className="space-y-3">
            {r.rounds.map((x, i) => (
              <li key={i} className="flex gap-4">
                <span className="h-8 w-8 shrink-0 rounded-full bg-mist grid place-items-center text-sm font-bold">{i + 1}</span>
                <div>
                  <p className="font-semibold">{x.name}</p>
                  <p className="text-sm text-muted">{x.format}</p>
                  <p className="text-sm mt-0.5">{x.what_they_check}</p>
                </div>
              </li>
            ))}
          </ol>
        </Block>
      )}

      {!!r.questions?.length && (
        <Block title="Questions people were asked">
          <ul className="space-y-3">
            {r.questions.map((q, i) => (
              <li key={i}>
                <details className="group rounded-2xl bg-paper px-4 py-3">
                  <summary className="cursor-pointer list-none flex items-start justify-between gap-3">
                    <span className="font-semibold leading-snug">{q.question}</span>
                    <span className="flex shrink-0 gap-1.5">
                      <span className="chip bg-mist text-muted">{q.type}</span>
                      {q.source && <span className="chip bg-mist text-muted">{q.source}</span>}
                    </span>
                  </summary>
                  <p className="text-sm mt-2 leading-relaxed">{q.tip}</p>
                </details>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted mt-2">Tap a question to see how to answer it with your own experience.</p>
        </Block>
      )}

      {!!r.recruiters_look_for?.length && (
        <Block title="What they look for">
          <ul className="list-disc pl-5 space-y-1.5">{r.recruiters_look_for.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </Block>
      )}

      {!!r.your_stories?.length && (
        <Block title="Stories to have ready">
          <ul className="space-y-3">
            {r.your_stories.map((x, i) => (
              <li key={i} className="rounded-2xl bg-paper px-4 py-3">
                <p className="font-semibold">{x.prompt}</p>
                <p className="text-sm mt-1 leading-relaxed">{x.use}</p>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {!!r.gaps_to_patch?.length && (
        <Block title="Weak spots to brush up">
          <ul className="space-y-2">
            {r.gaps_to_patch.map((x, i) => (
              <li key={i}>
                <span className="font-semibold">{x.topic}.</span> <span className="text-muted">{x.how}</span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {!!r.prep_plan?.length && (
        <Block title="Your prep plan">
          <div className="grid sm:grid-cols-2 gap-3">
            {r.prep_plan.map((d, i) => (
              <div key={i} className="rounded-2xl bg-paper px-4 py-3">
                <p className="font-semibold mb-1">{d.day}</p>
                <ul className="list-disc pl-5 text-sm space-y-1">{d.tasks.map((t, k) => <li key={k}>{t}</li>)}</ul>
              </div>
            ))}
          </div>
        </Block>
      )}

      {!!r.questions_to_ask?.length && (
        <Block title="Questions to ask them">
          <ul className="list-disc pl-5 space-y-1.5">{r.questions_to_ask.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </Block>
      )}
    </div>
  );
}

function UpskillView({ r }: { r: UpskillPlan }) {
  return (
    <div>
      <p className="text-muted leading-relaxed max-w-3xl">{r.summary}</p>
      {r.first_step_today && (
        <div className="mt-5 rounded-2xl bg-accent-soft px-5 py-4">
          <p className="text-sm font-semibold text-accent mb-0.5">Start today</p>
          <p>{r.first_step_today}</p>
        </div>
      )}

      {(r.skills || []).map((sk, i) => (
        <Block key={i} title={`${sk.name}${sk.weeks ? `, about ${sk.weeks} week${sk.weeks > 1 ? "s" : ""}` : ""}`}>
          <p className="text-sm mb-1"><span className="font-semibold">Why: </span>{sk.why}</p>
          <p className="text-sm text-muted mb-3">Level to reach: {sk.level_needed}</p>
          {!!sk.steps?.length && (
            <ol className="list-decimal pl-5 space-y-1.5 mb-4">{sk.steps.map((x, k) => <li key={k}>{x}</li>)}</ol>
          )}
          {!!sk.resources?.length && (
            <div className="mb-4">
              <p className="text-sm font-semibold mb-2">Where to learn</p>
              <div className="flex flex-wrap gap-2">
                {sk.resources.map((res, k) => (
                  <a
                    key={k}
                    href={searchUrl(res.name)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-full bg-mist hover:bg-ink hover:text-white px-3.5 py-1.5 text-sm transition-colors"
                  >
                    <span className="font-semibold">{res.name}</span>
                    <span className="opacity-60">{res.kind}{res.free ? ", free" : ", paid"}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
          {sk.project && <p className="text-sm mb-1"><span className="font-semibold">Prove it: </span>{sk.project}</p>}
          {sk.show_it && <p className="text-sm text-muted"><span className="font-semibold text-ink">Then show it: </span>{sk.show_it}</p>}
        </Block>
      ))}

      {!!r.weekly_plan?.length && (
        <Block title="Week by week">
          <ul className="space-y-2">
            {r.weekly_plan.map((w, i) => (
              <li key={i} className="flex gap-3">
                <span className="w-20 shrink-0 font-semibold">{w.week}</span>
                <span className="text-muted">{w.focus}</span>
              </li>
            ))}
          </ul>
        </Block>
      )}
    </div>
  );
}

function Sources({ s }: { s: CoachSession }) {
  if (!s.sources?.length && !s.search_html) {
    return (
      <p className="text-xs text-muted px-2">
        Coach couldn&apos;t search the web for this one, so it&apos;s based on general knowledge of the role and your CV.
      </p>
    );
  }
  return (
    <div className="card p-6">
      <p className="font-bold mb-3">Where this came from</p>
      {!!s.sources?.length && (
        <ul className="space-y-1.5 mb-4">
          {s.sources.map((x, i) => (
            <li key={i}>
              <a href={x.url} target="_blank" rel="noopener noreferrer" className="text-sm underline underline-offset-4 decoration-ink/30 hover:decoration-ink">
                {x.title}
              </a>
            </li>
          ))}
        </ul>
      )}
      {s.search_html && (
        <iframe
          title="Related Google searches"
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          className="w-full h-24 rounded-2xl"
          srcDoc={`<base target="_blank">${s.search_html}`}
        />
      )}
    </div>
  );
}
