"use client";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/supabase-browser";
import { useAuth } from "@/components/useAuth";
import Shell from "@/components/Shell";
import { CopyButton } from "@/components/ApplyPackPanel";
import type { Contact, Job } from "@/lib/types";

const FILTERS = [
  { id: "suggested", label: "To send" },
  { id: "sent", label: "Waiting for reply" },
  { id: "replied", label: "Replied" },
  { id: "referred", label: "Referred" },
  { id: "all", label: "All" },
] as const;
type Filter = (typeof FILTERS)[number]["id"];

const KIND: Record<string, string> = {
  recruiter: "Recruiter",
  hiring_manager: "Likely hiring manager",
  team_member: "Same team",
  alumni: "Shared background",
  other: "At the company",
};

const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);

function NetworkInner() {
  const { session } = useAuth();
  const params = useSearchParams();
  const onlyJob = params.get("job");
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [cap, setCap] = useState({ sentToday: 0, cap: 10 });
  const [filter, setFilter] = useState<Filter>("suggested");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [net, { jobs }] = await Promise.all([
      api<{ contacts: Contact[]; sentToday: number; cap: number }>("/api/contacts"),
      api<{ jobs: Job[] }>("/api/jobs"),
    ]);
    setContacts(net.contacts);
    setCap({ sentToday: net.sentToday, cap: net.cap });
    setJobs(jobs);
  }, []);

  useEffect(() => {
    if (session) load().catch((e) => setErr((e as Error).message));
  }, [session, load]);

  const jobById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);
  const scoped = (contacts || []).filter((c) => !onlyJob || c.job_id === onlyJob);
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { suggested: 0, sent: 0, replied: 0, referred: 0, all: scoped.length };
    for (const x of scoped) if (x.status in c) c[x.status as Filter]++;
    return c;
  }, [scoped]);
  const visible = scoped.filter((c) => (filter === "all" ? c.status !== "skipped" : c.status === filter));

  // Group by job
  const groups = useMemo(() => {
    const m = new Map<string, Contact[]>();
    for (const c of visible) {
      const k = c.job_id || "none";
      m.set(k, [...(m.get(k) || []), c]);
    }
    return [...m.entries()];
  }, [visible]);

  async function setStatus(c: Contact, status: Contact["status"]) {
    setErr(null);
    try {
      await api(`/api/contacts/${c.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function saveText(c: Contact, field: "note" | "message", value: string) {
    if ((c[field] || "") === value) return;
    await api(`/api/contacts/${c.id}`, { method: "PATCH", body: JSON.stringify({ [field]: value }) });
    load();
  }

  const left = Math.max(0, cap.cap - cap.sentToday);

  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-6 mb-8">
        <div className="max-w-2xl">
          <h1 className="display text-4xl sm:text-5xl mb-3">Network</h1>
          <p className="text-muted leading-relaxed">
            People Networker found for your referral-first jobs, with messages drafted in your voice. You send each one
            yourself on LinkedIn, then mark it here so you can see who you asked and how long ago.
          </p>
        </div>
        <div className="card px-6 py-4 min-w-[220px]">
          <p className="text-3xl font-bold tabular-nums">
            {cap.sentToday}<span className="text-muted text-xl"> / {cap.cap}</span>
          </p>
          <p className="text-sm text-muted">new people messaged today</p>
          <div className="mt-2 h-1.5 rounded-full bg-mist overflow-hidden">
            <div className="h-full bg-ink rounded-full" style={{ width: `${Math.min(100, (cap.sentToday / Math.max(1, cap.cap)) * 100)}%` }} />
          </div>
        </div>
      </div>

      {onlyJob && (
        <p className="mb-4 text-sm">
          Showing people for <b>{jobById.get(onlyJob)?.title || "one job"}</b>.{" "}
          <Link href="/network" className="underline underline-offset-4">Show everyone</Link>
        </p>
      )}

      <div className="flex gap-2 overflow-x-auto mb-5 pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-colors ${filter === f.id ? "bg-ink text-white" : "bg-card text-ink hover:bg-mist"}`}
          >
            {f.label} <span className={filter === f.id ? "text-white/60" : "text-muted"}>{counts[f.id]}</span>
          </button>
        ))}
      </div>
      {err && <p className="text-sm text-rose mb-4">{err}</p>}

      {contacts === null ? (
        <p className="text-muted">Loading…</p>
      ) : groups.length === 0 ? (
        <div className="card p-10 text-center text-muted">
          {contacts.length === 0
            ? "No one yet. On the dashboard, open a job Applier marked “referral first” and click “Find people to ask”. The daily run also does this for you."
            : "Nothing in this list."}
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map(([jobId, list]) => {
            const job = jobById.get(jobId);
            return (
              <section key={jobId}>
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
                  <h2 className="text-lg font-bold">
                    {job ? `${job.title} at ${job.company}` : list[0].company || "Other"}
                  </h2>
                  {job && (
                    <a href={job.url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold underline underline-offset-4">
                      Job link
                    </a>
                  )}
                </div>
                <ul className="space-y-3">
                  {list.map((c) => (
                    <ContactCard key={c.id} c={c} left={left} onStatus={setStatus} onSave={saveText} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </Shell>
  );
}

function ContactCard({
  c,
  left,
  onStatus,
  onSave,
}: {
  c: Contact;
  left: number;
  onStatus: (c: Contact, s: Contact["status"]) => void;
  onSave: (c: Contact, f: "note" | "message", v: string) => void;
}) {
  const [open, setOpen] = useState(c.status === "suggested");
  const [note, setNote] = useState(c.note || "");
  const [message, setMessage] = useState(c.message || "");
  const days = c.sent_at ? daysSince(c.sent_at) : null;

  return (
    <li className="card p-5">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1 min-w-[220px]">
          <div className="flex flex-wrap items-center gap-2 mb-0.5">
            <a href={c.profile_url} target="_blank" rel="noopener noreferrer" className="text-lg font-bold hover:underline underline-offset-4">
              {c.name}
            </a>
            {c.degree && <span className="chip bg-mist text-muted">{c.degree}</span>}
            {c.kind && <span className="chip bg-mist text-muted">{KIND[c.kind] || c.kind}</span>}
          </div>
          {c.headline && <p className="text-sm text-muted line-clamp-2">{c.headline}</p>}
          {c.why && <p className="text-sm mt-1">{c.why}</p>}
        </div>
        <div className="text-right">
          {c.status === "suggested" && <span className="chip bg-mist text-muted">Not sent yet</span>}
          {c.status === "sent" && (
            <span className={`chip ${days !== null && days >= 5 ? "bg-amber-soft text-amber" : "bg-mist text-muted"}`}>
              Sent {days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`}
            </span>
          )}
          {c.status === "replied" && <span className="chip bg-accent-soft text-accent">Replied</span>}
          {c.status === "referred" && <span className="chip bg-ink text-white">Referred you</span>}
        </div>
      </div>

      {c.status === "sent" && days !== null && days >= 5 && (
        <p className="text-sm text-amber mt-2">No reply after {days} days. A short, friendly follow-up is fine now.</p>
      )}

      <button className="text-sm font-semibold underline underline-offset-4 mt-3" onClick={() => setOpen(!open)}>
        {open ? "Hide messages" : "Show messages"}
      </button>

      {open && (
        <div className="grid md:grid-cols-2 gap-4 mt-3">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-sm font-semibold">Connection note <span className={`font-normal ${note.length > 300 ? "text-rose" : "text-muted"}`}>{note.length}/300</span></p>
              <CopyButton text={note} />
            </div>
            <textarea className="input min-h-28 text-sm" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} onBlur={() => onSave(c, "note", note)} />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-sm font-semibold">After they accept</p>
              <CopyButton text={message} />
            </div>
            <textarea className="input min-h-28 text-sm" value={message} onChange={(e) => setMessage(e.target.value)} onBlur={() => onSave(c, "message", message)} />
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-4">
        <a href={c.profile_url} target="_blank" rel="noopener noreferrer" className="btn-ghost py-1.5">Open LinkedIn profile</a>
        {c.status === "suggested" && (
          <>
            <button className="btn-primary py-1.5" disabled={left <= 0} onClick={() => onStatus(c, "sent")} title={left <= 0 ? "Today's limit reached" : ""}>
              I sent it
            </button>
            <button className="btn-ghost py-1.5" onClick={() => onStatus(c, "skipped")}>Skip</button>
          </>
        )}
        {c.status === "sent" && (
          <>
            <button className="btn-ghost py-1.5" onClick={() => onStatus(c, "replied")}>They replied</button>
            <button className="btn-primary py-1.5" onClick={() => onStatus(c, "referred")}>They referred me</button>
          </>
        )}
        {c.status === "replied" && <button className="btn-primary py-1.5" onClick={() => onStatus(c, "referred")}>They referred me</button>}
        {c.status !== "suggested" && c.status !== "skipped" && (
          <button className="btn-ghost py-1.5" onClick={() => onStatus(c, "suggested")}>Undo</button>
        )}
      </div>
      {c.status === "suggested" && left <= 0 && (
        <p className="text-xs text-muted mt-2">You&apos;ve reached today&apos;s limit of new people. This one will be here tomorrow.</p>
      )}
    </li>
  );
}

export default function NetworkPage() {
  return (
    <Suspense>
      <NetworkInner />
    </Suspense>
  );
}
