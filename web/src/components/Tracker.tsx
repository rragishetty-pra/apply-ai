"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/supabase-browser";
import { portalName } from "@/lib/portal-list";
import { GROUPS, STEPS, jobStage, type Group, type Stage } from "@/lib/job-stage";
import ApplyPackPanel from "@/components/ApplyPackPanel";
import type { Contact, Job } from "@/lib/types";

const TONE: Record<Stage["tone"], string> = {
  action: "bg-ink text-white",
  wait: "bg-[#e6ebf2] text-[#3c5274]",
  good: "bg-accent-soft text-accent",
  warn: "bg-amber-soft text-amber",
  muted: "bg-mist text-muted",
  bad: "bg-rose-soft text-rose",
};

type Sort = "next" | "match" | "recent";

const STATUS_OPTIONS: { value: string; label: string; body: Record<string, unknown> }[] = [
  { value: "applied", label: "Applied", body: { applied: true, stage: null } },
  { value: "interview", label: "Interview scheduled", body: { applied: true, stage: "interview" } },
  { value: "offer", label: "Got an offer", body: { applied: true, stage: "offer" } },
  { value: "rejected", label: "Not selected", body: { stage: "rejected" } },
  { value: "not_applied", label: "Not applied yet", body: { applied: false, stage: null } },
  { value: "not_interested", label: "Not interested", body: { skip: true } },
];

const GROUP_ORDER: Record<Group, number> = { action: 0, interviews: 1, waiting: 2, applied: 3, wishlist: 4, potential: 5, progress: 6, closed: 7 };

export default function Tracker({
  jobs,
  contacts,
  onReload,
  unlocks,
}: {
  jobs: Job[];
  contacts: Contact[];
  onReload: () => void;
  unlocks: { name: string; jobs: number }[];
}) {
  const router = useRouter();
  const byJob = useMemo(() => {
    const m = new Map<string, Contact[]>();
    for (const c of contacts) if (c.job_id) m.set(c.job_id, [...(m.get(c.job_id) || []), c]);
    return m;
  }, [contacts]);

  const rows = useMemo(() => jobs.map((j) => ({ job: j, stage: jobStage(j, byJob.get(j.id) || []) })), [jobs, byJob]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const r of rows) c[r.stage.group] = (c[r.stage.group] || 0) + 1;
    return c;
  }, [rows]);

  const [group, setGroup] = useState<Group | "all">("action");
  const [picked, setPicked] = useState(false);
  useEffect(() => {
    // Open on "Needs you" when there's something to do, otherwise on everything.
    if (!picked && rows.length) setGroup(counts.action ? "action" : "all");
  }, [rows.length, counts.action, picked]);

  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("next");
  const [openId, setOpenId] = useState<string | null>(null);

  const visible = useMemo(() => {
    const text = q.trim().toLowerCase();
    const list = rows.filter(
      (r) =>
        (group === "all" || r.stage.group === group) &&
        (!text || `${r.job.title} ${r.job.company} ${r.job.location}`.toLowerCase().includes(text))
    );
    return list.sort((a, b) => {
      if (sort === "match") return (b.job.match_percent ?? -1) - (a.job.match_percent ?? -1);
      if (sort === "recent") return +new Date(b.job.created_at) - +new Date(a.job.created_at);
      return GROUP_ORDER[a.stage.group] - GROUP_ORDER[b.stage.group] || (b.job.match_percent ?? -1) - (a.job.match_percent ?? -1);
    });
  }, [rows, group, q, sort]);

  const pick = (g: Group | "all") => {
    setPicked(true);
    setGroup(g);
  };

  const SUMMARY: { id: Group; label: string }[] = [
    { id: "action", label: "Needs you" },
    { id: "waiting", label: "Waiting on referral" },
    { id: "applied", label: "Applied" },
    { id: "interviews", label: "Interviews & offers" },
    { id: "wishlist", label: "Wishlist" },
  ];

  return (
    <section aria-label="Your applications">
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        {SUMMARY.map((s) => (
          <button
            key={s.id}
            onClick={() => pick(s.id)}
            className={`rounded-[22px] px-5 py-4 text-left transition-colors ${group === s.id ? "bg-ink text-white" : "bg-card hover:bg-mist"}`}
          >
            <span className="block text-3xl font-bold tabular-nums">{counts[s.id] || 0}</span>
            <span className={`block text-sm ${group === s.id ? "text-white/70" : "text-muted"}`}>{s.label}</span>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-4">
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 lg:flex-1 min-w-0">
          {GROUPS.filter((g) => !["action", "waiting", "applied", "interviews", "wishlist"].includes(g.id)).map((g) => (
            <button
              key={g.id}
              onClick={() => pick(g.id)}
              title={g.hint}
              className={`px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-colors ${group === g.id ? "bg-ink text-white" : "bg-card text-ink hover:bg-mist"}`}
            >
              {g.label} <span className={group === g.id ? "text-white/60" : "text-muted"}>{counts[g.id] || 0}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input className="input flex-1 lg:w-[220px] py-2" placeholder="Search jobs" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search jobs" />
          <select className="input w-auto py-2" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
            <option value="next">Next step</option>
            <option value="match">Best match</option>
            <option value="recent">Newest</option>
          </select>
        </div>
      </div>
      <p className="text-sm text-muted mb-4">{GROUPS.find((g) => g.id === group)?.hint}</p>

      {(group === "potential" || group === "wishlist") && unlocks.length > 0 && (
        <div className="card p-6 mb-4">
          <p className="text-lg font-bold tracking-tight mb-1">Skills that would unlock more jobs</p>
          <p className="text-sm text-muted mb-4">Learning one or two of these would make you a match. Pick one for a learning plan.</p>
          <div className="flex flex-wrap gap-2">
            {unlocks.map((u) => (
              <Link key={u.name} href={`/coach?skill=${encodeURIComponent(u.name)}`} className="inline-flex items-center gap-2 rounded-full bg-mist hover:bg-ink hover:text-white px-4 py-2 text-sm transition-colors">
                <span className="font-semibold">{u.name}</span>
                <span className="opacity-60">{u.jobs} job{u.jobs > 1 ? "s" : ""}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* List */}
      {visible.length === 0 ? (
        <div className="card p-10 text-center text-muted">
          {jobs.length === 0
            ? "No jobs yet. Run Hunter from the card above, and new jobs will show up here."
            : q
            ? "No jobs match your search."
            : group === "action"
            ? "Nothing needs you right now."
            : "Nothing here right now."}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="hidden lg:grid grid-cols-[minmax(0,2.2fr)_70px_minmax(0,1.6fr)_minmax(0,1.1fr)_150px] gap-4 px-5 py-3 text-xs font-semibold text-muted border-b border-line">
            <span>Job</span>
            <span>Match</span>
            <span>Status</span>
            <span>Next step</span>
            <span>Update</span>
          </div>
          <ul className="divide-y divide-line">
            {visible.map(({ job, stage }) => (
              <Row
                key={job.id}
                job={job}
                stage={stage}
                contacts={byJob.get(job.id) || []}
                open={openId === job.id}
                onToggle={() => setOpenId(openId === job.id ? null : job.id)}
                onReload={onReload}
                go={(href) => router.push(href)}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Progress({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-1 mt-2" aria-label={`Stage: ${STEPS[step]}`}>
      {STEPS.map((s, i) => (
        <span key={s} title={s} className={`h-1.5 flex-1 max-w-6 rounded-full ${i <= step ? "bg-ink" : "bg-[#dcdbd6]"}`} />
      ))}
    </div>
  );
}

function Row({
  job,
  stage,
  contacts,
  open,
  onToggle,
  onReload,
  go,
}: {
  job: Job;
  stage: Stage;
  contacts: Contact[];
  open: boolean;
  onToggle: () => void;
  onReload: () => void;
  go: (href: string) => void;
}) {
  const [confirmApplied, setConfirmApplied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState(job.notes || "");
  const [when, setWhen] = useState(job.interview_at || "");

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await api(`/api/jobs/${job.id}`, { method: "PATCH", body: JSON.stringify(body) });
      onReload();
    } finally {
      setBusy(false);
    }
  }

  async function nextStep() {
    const k = stage.next?.kind;
    if (k === "apply" || k === "open") {
      window.open(job.url, "_blank", "noopener,noreferrer");
      if (k === "apply") setConfirmApplied(true);
    } else if (k === "prepare") {
      setBusy(true);
      try {
        await api("/api/applier/next", { method: "POST", body: JSON.stringify({ job_id: job.id }) });
        onReload();
      } finally {
        setBusy(false);
      }
    } else if (k === "find_people") {
      if (!open) onToggle();
    } else if (k === "network") go(`/network?job=${job.id}`);
    else if (k === "coach") go(`/coach?job=${job.id}`);
    else if (k === "learn") go(`/coach?job=${job.id}&mode=upskill`);
    else if (k === "retry") patch({ retailor: true });
  }

  async function download() {
    const { url } = await api<{ url: string }>(`/api/jobs/${job.id}/resume`);
    window.location.href = url;
  }

  const current =
    job.stage === "offer" ? "offer" : job.stage === "rejected" ? "rejected" : job.stage === "interview" ? "interview" : job.stage === "not_interested" ? "not_interested" : job.applied ? "applied" : "not_applied";
  const a = job.analysis;

  return (
    <li>
      <div className="grid lg:grid-cols-[minmax(0,2.2fr)_70px_minmax(0,1.6fr)_minmax(0,1.1fr)_150px] gap-x-4 gap-y-3 px-5 py-4 items-start">
        {/* Job */}
        <div className="min-w-0">
          <button onClick={onToggle} aria-expanded={open} className="text-left font-bold leading-snug hover:underline decoration-ink/30 decoration-2 underline-offset-4">
            {job.title}
          </button>
          <p className="text-sm text-muted truncate">{[job.company, job.location].filter(Boolean).join(", ")}</p>
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            <span className="chip bg-mist text-muted">{portalName(job.portal)}</span>
            {job.wishlisted && stage.key !== "wishlist" && <span className="chip bg-mist text-muted">Wishlist</span>}
          </div>
        </div>

        {/* Match */}
        <div className="flex lg:block items-center gap-2">
          <span className="lg:hidden text-xs text-muted">Match</span>
          <span className={`text-lg font-bold tabular-nums ${job.match_percent === null ? "text-muted" : job.status === "tailored" ? "text-accent" : job.status === "stretch" ? "text-amber" : "text-muted"}`}>
            {job.match_percent === null ? "—" : `${job.match_percent}%`}
          </span>
        </div>

        {/* Status */}
        <div className="min-w-0">
          <span className={`chip px-3 py-1 text-sm ${TONE[stage.tone]}`}>{stage.label}</span>
          {stage.detail && <p className="text-sm text-muted mt-1.5 leading-snug">{stage.detail}</p>}
          <Progress step={stage.step} />
        </div>

        {/* Next step */}
        <div className="flex flex-wrap gap-2">
          {stage.next && (
            <button className={stage.tone === "action" ? "btn-primary py-1.5" : "btn-ghost py-1.5"} disabled={busy} onClick={nextStep}>
              {busy && stage.next.kind === "prepare" ? "Preparing…" : stage.next.label}
            </button>
          )}
          {job.tailored_path && (
            <button className="btn-ghost py-1.5" onClick={download} title="Download your tailored CV for this job">CV</button>
          )}
          <button className="btn-ghost py-1.5" onClick={onToggle} aria-expanded={open}>{open ? "Less" : "Details"}</button>
        </div>

        {/* Update status */}
        <div>
          <select
            className="input py-2 text-sm"
            aria-label="Update status"
            value={current}
            disabled={busy}
            onChange={(e) => {
              const opt = STATUS_OPTIONS.find((o) => o.value === e.target.value);
              if (opt) patch(opt.body);
            }}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {confirmApplied && (
        <div className="mx-5 mb-4 rounded-[18px] bg-paper px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">Did you submit the application for <b>{job.title}</b>?</p>
          <div className="flex gap-2">
            <button className="btn-primary py-1.5" onClick={() => { setConfirmApplied(false); patch({ applied: true }); }}>Yes, mark applied</button>
            <button className="btn-ghost py-1.5" onClick={() => setConfirmApplied(false)}>Not yet</button>
          </div>
        </div>
      )}

      {open && (
        <div className="border-t border-line bg-paper/50 px-5 py-5 space-y-6 text-sm">
          {job.status === "tailored" && !job.applied && <ApplyPackPanel job={job} contacts={contacts} onChanged={onReload} />}

          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-3">
              {a?.summary && <p>{a.summary}</p>}
              {a?.must_haves_met && <p className="text-muted">Must-haves met: {a.must_haves_met}</p>}
              {!!a?.matched?.length && (
                <div>
                  <p className="font-semibold mb-1">You match</p>
                  <div className="flex flex-wrap gap-1.5">{a.matched.map((m) => <span key={m} className="chip bg-accent-soft text-accent">{m}</span>)}</div>
                </div>
              )}
              {!!a?.gaps?.length && (
                <div>
                  <p className="font-semibold mb-1">Gaps</p>
                  <div className="flex flex-wrap gap-1.5">{a.gaps.map((g) => <span key={g} className="chip bg-amber-soft text-amber">{g}</span>)}</div>
                </div>
              )}
              {!!job.tailored_edits?.changes?.length && (
                <details className="rounded-[18px] bg-card px-4 py-3">
                  <summary className="cursor-pointer font-semibold">What Tailor changed in your CV ({job.tailored_edits.changes.length})</summary>
                  <ul className="space-y-2 mt-3">
                    {job.tailored_edits.changes.map((c, k) => (
                      <li key={k}>
                        {c.before && <p className="text-muted line-through decoration-muted/40">{c.before}</p>}
                        <p>{c.after}</p>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
            <div className="space-y-3">
              {job.stage === "interview" && (
                <div>
                  <label className="label" htmlFor={`iv-${job.id}`}>Interview date</label>
                  <input id={`iv-${job.id}`} className="input" placeholder="e.g. 28 Oct, 11 AM" value={when} onChange={(e) => setWhen(e.target.value)} onBlur={() => when !== (job.interview_at || "") && patch({ interview_at: when })} />
                </div>
              )}
              <div>
                <label className="label" htmlFor={`nt-${job.id}`}>Notes</label>
                <textarea id={`nt-${job.id}`} className="input min-h-20" value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (job.notes || "") && patch({ notes })} placeholder="Recruiter name, follow-up date…" />
              </div>
              <div className="flex flex-wrap gap-2">
                <a className="btn-ghost py-1.5" href={job.url} target="_blank" rel="noopener noreferrer">Open job posting</a>
                {job.status === "stretch" && (
                  <button className="btn-ghost py-1.5" aria-pressed={job.wishlisted} onClick={() => patch({ wishlisted: !job.wishlisted })}>
                    {job.wishlisted ? "Remove from wishlist" : "Save to wishlist"}
                  </button>
                )}
                {["stretch", "skipped", "error", "tailored"].includes(job.status) && !job.applied && (
                  <button className="btn-ghost py-1.5" onClick={() => patch({ retailor: true })}>Re-run Tailor</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}
