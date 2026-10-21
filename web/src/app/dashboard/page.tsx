"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/supabase-browser";
import { useAuth } from "@/components/useAuth";
import Shell from "@/components/Shell";
import { useExtension } from "@/components/ExtensionConnect";
import { JobTicker } from "@/components/Trending";
import type { TickerJob } from "@/lib/stats";
import { clearPendingRole, readPendingRole, withRole } from "@/lib/pending-role";
import type { Job, Prefs } from "@/lib/types";

interface ProfileLite {
  full_name: string | null;
  onboarded: boolean;
  cv_format: string | null;
  last_hunter_at: string | null;
  portal_status: Record<string, string>;
  prefs: Prefs;
}

const TABS = [
  { id: "tailored", label: "Tailored" },
  { id: "stretch", label: "Stretch" },
  { id: "waiting", label: "In progress" },
  { id: "applied", label: "Applied" },
  { id: "skipped", label: "Skipped" },
  { id: "all", label: "All" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const PORTAL_NAME: Record<string, string> = { linkedin: "LinkedIn", naukri: "Naukri", indeed: "Indeed", other: "Other" };

function ago(iso: string | null) {
  if (!iso) return "never";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export default function Dashboard() {
  const { session } = useAuth();
  const router = useRouter();
  const extension = useExtension();
  const [profile, setProfile] = useState<ProfileLite | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [tab, setTab] = useState<Tab>("tailored");
  const [tailoring, setTailoring] = useState<string | null>(null);
  const [hunterMsg, setHunterMsg] = useState<string | null>(null);
  const [pendingRole, setPendingRole] = useState<string | null>(null);
  const stopRef = useRef(false);
  const [ticker, setTicker] = useState<TickerJob[]>([]);

  useEffect(() => {
    fetch("/api/stats/today").then((r) => r.json()).then((s) => setTicker(s.ticker || [])).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    const [{ profile }, { jobs }] = await Promise.all([
      api<{ profile: ProfileLite }>("/api/profile"),
      api<{ jobs: Job[] }>("/api/jobs"),
    ]);
    if (!profile.onboarded) return router.replace("/onboarding");
    setProfile(profile);
    const r = readPendingRole();
    if (r && !profile.prefs.target_roles.some((x) => x.toLowerCase() === r.toLowerCase())) setPendingRole(r);
    else clearPendingRole();
    setJobs(jobs);
  }, [router]);

  useEffect(() => {
    if (!session) return;
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [session, load]);

  const counts = useMemo(() => {
    const c = { tailored: 0, stretch: 0, waiting: 0, applied: 0, skipped: 0, all: jobs.length };
    for (const j of jobs) {
      if (j.applied) c.applied++;
      if (j.status === "tailored" && !j.applied) c.tailored++;
      else if (j.status === "stretch") c.stretch++;
      else if (["found", "pending", "scoring", "error"].includes(j.status)) c.waiting++;
      else if (j.status === "skipped") c.skipped++;
    }
    return c;
  }, [jobs]);

  const visible = useMemo(() => {
    const list = jobs.filter((j) => {
      switch (tab) {
        case "tailored": return j.status === "tailored" && !j.applied;
        case "stretch": return j.status === "stretch";
        case "waiting": return ["found", "pending", "scoring", "error"].includes(j.status);
        case "applied": return j.applied;
        case "skipped": return j.status === "skipped";
        default: return true;
      }
    });
    return tab === "tailored" || tab === "stretch" ? [...list].sort((a, b) => (b.match_percent ?? 0) - (a.match_percent ?? 0)) : list;
  }, [jobs, tab]);

  const pending = jobs.filter((j) => j.status === "pending").length;

  async function runTailor() {
    stopRef.current = false;
    setTailoring("Starting…");
    let n = 0;
    try {
      while (!stopRef.current) {
        const r = await api<{ done: boolean; remaining: number; rate_limited?: boolean; job?: { title: string; status: string; match_percent: number } }>("/api/tailor/next", { method: "POST" });
        if (r.done) break;
        if (r.rate_limited) {
          setTailoring(`AI limit reached — waiting a minute (${r.remaining} left)…`);
          await new Promise((res) => setTimeout(res, 60_000));
          continue;
        }
        n++;
        setTailoring(`Done ${n} · ${r.remaining} left${r.job ? ` · last: ${r.job.title} (${r.job.match_percent ?? "–"}%)` : ""}`);
        await load();
        await new Promise((res) => setTimeout(res, 5000)); // stay under free-tier per-minute limits
      }
    } catch (e) {
      setTailoring((e as Error).message);
      await new Promise((res) => setTimeout(res, 4000));
    }
    setTailoring(null);
    load();
  }

  function runHunter() {
    setHunterMsg("Asking the extension to start…");
    const id = Math.random().toString(36).slice(2);
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window || e.data?.source !== "applyai-ext" || e.data?.id !== id) return;
      window.removeEventListener("message", onMsg);
      setHunterMsg(e.data.error ? e.data.error : "Hunter is running in your Chrome. New jobs will appear here as it goes.");
      setTimeout(() => setHunterMsg(null), 8000);
    };
    window.addEventListener("message", onMsg);
    window.postMessage({ source: "applyai-web", id, type: "RUN_HUNTER" }, window.location.origin);
  }

  async function patch(id: string, body: Record<string, unknown>) {
    await api(`/api/jobs/${id}`, { method: "PATCH", body: JSON.stringify(body) });
    load();
  }

  async function download(id: string) {
    const { url } = await api<{ url: string }>(`/api/jobs/${id}/resume`);
    window.location.href = url;
  }

  if (!session || !profile) return <Shell><p className="text-muted">Loading…</p></Shell>;

  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <p className="font-semibold text-muted mb-2">Hey{profile.full_name ? ` ${profile.full_name.split(" ")[0]}` : ""}, here&apos;s your hunt</p>
          <h1 className="display text-4xl sm:text-5xl">Your pipeline</h1>
        </div>
      </div>

      {ticker.length > 0 && (
        <div className="mb-8 -mx-4 sm:mx-0 sm:rounded-[28px] bg-mist py-3">
          <p className="px-5 pb-1 text-sm font-semibold text-muted">Fresh on the portals today. Click to open a job.</p>
          <JobTicker jobs={ticker} />
        </div>
      )}

      {pendingRole && (
        <div className="card px-6 py-5 mb-8 flex flex-wrap items-center justify-between gap-4">
          <p>
            Add <b>{pendingRole}</b> to the roles Hunter searches for?
          </p>
          <div className="flex gap-2">
            <button
              className="btn-primary"
              onClick={async () => {
                const prefs = { ...profile.prefs, target_roles: withRole(profile.prefs.target_roles, pendingRole) };
                await api("/api/profile", { method: "POST", body: JSON.stringify({ prefs }) });
                clearPendingRole();
                setPendingRole(null);
                load();
              }}
            >
              Add role
            </button>
            <button className="btn-ghost" onClick={() => { clearPendingRole(); setPendingRole(null); }}>No thanks</button>
          </div>
        </div>
      )}

      {/* Agents */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
        <AgentCard name="Hunter" live detail={`Last run ${ago(profile.last_hunter_at)}`}>
          {extension ? (
            <button className="btn-primary w-full" onClick={runHunter}>Run Hunter now</button>
          ) : (
            <a className="btn-ghost w-full" href="/settings">Connect Chrome extension</a>
          )}
          {hunterMsg && <p className="text-xs text-muted mt-2">{hunterMsg}</p>}
        </AgentCard>
        <AgentCard name="Tailor" live detail={pending ? `${pending} job${pending > 1 ? "s" : ""} waiting` : "Queue is empty"}>
          {tailoring ? (
            <button className="btn-ghost w-full" onClick={() => (stopRef.current = true)}>Stop</button>
          ) : (
            <button className="btn-accent w-full" disabled={!pending} onClick={runTailor}>Run Tailor</button>
          )}
          {tailoring && <p className="text-xs text-muted mt-2">{tailoring}</p>}
        </AgentCard>
        <div className="card p-6 flex flex-col">
          <p className="text-xl font-bold tracking-tight mb-4">Progress</p>
          <div className="grid grid-cols-3 gap-2 flex-1">
            {([
              ["tailored", "Ready", counts.tailored],
              ["stretch", "Stretch", counts.stretch],
              ["applied", "Applied", counts.applied],
            ] as const).map(([id, label, n]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className="rounded-[18px] bg-paper hover:bg-mist transition-colors px-3 py-3 text-left"
              >
                <span className="block text-3xl font-bold tabular-nums">{n}</span>
                <span className="block text-xs text-muted mt-1">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto mb-5 pb-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-colors ${tab === t.id ? "bg-ink text-white" : "bg-card text-ink hover:bg-mist"}`}
          >
            {t.label} <span className={tab === t.id ? "text-white/60" : "text-muted"}>{counts[t.id]}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="card p-10 text-center text-muted">
          {jobs.length === 0
            ? "No jobs yet. Run Hunter from the card above (or the extension), and new jobs will show up here."
            : "Nothing in this list right now."}
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((j) => (
            <JobRow key={j.id} job={j} onPatch={patch} onDownload={download} />
          ))}
        </div>
      )}
    </Shell>
  );
}

function AgentCard({ name, live, detail, children }: { name: string; live?: boolean; detail: string; children?: React.ReactNode }) {
  return (
    <div className={`card p-6 flex flex-col ${live ? "" : "opacity-60"}`}>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xl font-bold tracking-tight">{name}</p>
        <span className={`chip ${live ? "bg-accent-soft text-accent" : "bg-mist text-muted"}`}>{live ? "Live" : "Coming next"}</span>
      </div>
      <p className="text-sm text-muted mb-4 flex-1">{detail}</p>
      {children}
    </div>
  );
}

function StatusChip({ job }: { job: Job }) {
  if (job.applied) return <span className="chip bg-ink text-white">Applied</span>;
  const map: Record<string, [string, string]> = {
    tailored: ["Tailored", "bg-accent-soft text-accent"],
    stretch: ["Stretch", "bg-amber-soft text-amber"],
    skipped: ["Skipped", "bg-mist text-muted"],
    found: ["Reading job…", "bg-mist text-muted"],
    pending: ["Waiting for Tailor", "bg-mist text-muted"],
    scoring: ["Tailoring…", "bg-mist text-muted"],
    error: ["Problem", "bg-rose-soft text-rose"],
  };
  const [label, cls] = map[job.status] || [job.status, "bg-mist text-muted"];
  return <span className={`chip ${cls}`}>{label}</span>;
}

function JobRow({ job, onPatch, onDownload }: { job: Job; onPatch: (id: string, b: Record<string, unknown>) => Promise<void>; onDownload: (id: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(job.notes || "");
  const a = job.analysis;

  return (
    <div className="card">
      <div className="p-4 sm:p-5 flex flex-wrap items-center gap-4">
        <div className={`w-16 h-16 shrink-0 grid place-items-center rounded-full ${job.status === "tailored" ? "bg-accent-soft" : job.status === "stretch" ? "bg-amber-soft" : "bg-mist"}`}>
          {job.match_percent !== null ? (
            <p className={`text-2xl font-bold leading-none tabular-nums ${job.status === "tailored" ? "text-accent" : job.status === "stretch" ? "text-amber" : "text-muted"}`}>
              {job.match_percent}<span className="text-base">%</span>
            </p>
          ) : (
            <p className="text-muted text-sm">—</p>
          )}
        </div>
        <div className="flex-1 min-w-[200px]">
          <button className="text-left text-lg font-bold leading-snug hover:underline decoration-ink/30 decoration-2 underline-offset-4" onClick={() => setOpen(!open)}>{job.title}</button>
          <p className="text-sm text-muted flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5">
            <span>{[job.company, job.location].filter(Boolean).join(", ")}</span>
            <span className="chip bg-mist text-muted">{PORTAL_NAME[job.portal] || job.portal}</span>
          </p>
        </div>
        <StatusChip job={job} />
        <div className="flex gap-2">
          {job.tailored_path && <button className="btn-accent py-1.5" onClick={() => onDownload(job.id)}>Download CV</button>}
          <a className="btn-ghost py-1.5" href={job.url} target="_blank" rel="noreferrer">Open job</a>
          <button className="btn-ghost py-1.5" onClick={() => setOpen(!open)}>{open ? "Less" : "More"}</button>
        </div>
      </div>

      {open && (
        <div className=" border-t border-line p-4 sm:p-5 grid md:grid-cols-2 gap-6 text-sm">
          <div className="space-y-3">
            {a?.summary && <p>{a.summary}</p>}
            {a?.skip_reason && <p className="text-muted">Skipped: {a.skip_reason}</p>}
            {job.error && <p className="text-rose">{job.error}</p>}
            {a?.must_haves_met && <p className="text-muted">Must-haves met: {a.must_haves_met}</p>}
            {!!a?.matched?.length && (
              <div>
                <p className="font-medium mb-1">You match</p>
                <div className="flex flex-wrap gap-1.5">{a.matched.map((m) => <span key={m} className="chip bg-accent-soft text-accent">{m}</span>)}</div>
              </div>
            )}
            {!!a?.gaps?.length && (
              <div>
                <p className="font-medium mb-1">{job.status === "stretch" ? "Skills to build for this one" : "Gaps"}</p>
                <div className="flex flex-wrap gap-1.5">{a.gaps.map((g) => <span key={g} className="chip bg-amber-soft text-amber">{g}</span>)}</div>
              </div>
            )}
          </div>

          <div className="space-y-3">
            {!!job.tailored_edits?.changes?.length && (
              <div>
                <p className="font-medium mb-1">What Tailor changed</p>
                {job.tailored_edits.note && <p className="text-muted mb-2">{job.tailored_edits.note}</p>}
                <ul className="space-y-2 max-h-72 overflow-auto pr-1">
                  {job.tailored_edits.changes.map((c, k) => (
                    <li key={k} className="rounded-2xl bg-paper p-3">
                      {c.before && <p className="text-muted line-through decoration-muted/40">{c.before}</p>}
                      <p>{c.after}</p>
                      {c.why && <p className="text-xs text-muted mt-1">{c.why}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <p className="font-medium mb-1">Notes</p>
              <textarea className="input min-h-20" value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (job.notes || "") && onPatch(job.id, { notes })} placeholder="Recruiter name, follow-up date…" />
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn-ghost py-1.5" onClick={() => onPatch(job.id, { applied: !job.applied })}>
                {job.applied ? "Mark not applied" : "Mark as applied"}
              </button>
              {["stretch", "skipped", "error", "tailored"].includes(job.status) && (
                <button className="btn-ghost py-1.5" onClick={() => onPatch(job.id, { retailor: true })}>Re-run Tailor</button>
              )}
              {job.status !== "skipped" && (
                <button className="btn-ghost py-1.5" onClick={() => onPatch(job.id, { skip: true })}>Not interested</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
