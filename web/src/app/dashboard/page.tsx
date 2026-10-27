"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/supabase-browser";
import { useAuth } from "@/components/useAuth";
import Shell from "@/components/Shell";
import { useExtension } from "@/components/ExtensionConnect";
import { JobTicker } from "@/components/Trending";
import type { TickerJob } from "@/lib/stats";
import { clearPendingRole, readPendingRole, withRole } from "@/lib/pending-role";
import Tracker from "@/components/Tracker";
import type { Contact, Job, Prefs } from "@/lib/types";

interface ProfileLite {
  full_name: string | null;
  onboarded: boolean;
  cv_format: string | null;
  last_hunter_at: string | null;
  portal_status: Record<string, string>;
  prefs: Prefs;
}



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
  const [tailoring, setTailoring] = useState<string | null>(null);
  const [hunterMsg, setHunterMsg] = useState<string | null>(null);
  const [pendingRole, setPendingRole] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [netCap, setNetCap] = useState({ sentToday: 0, cap: 10 });
  const [applying, setApplying] = useState<string | null>(null);
  const stopRef = useRef(false);
  const [ticker, setTicker] = useState<TickerJob[]>([]);

  useEffect(() => {
    fetch("/api/stats/today").then((r) => r.json()).then((s) => setTicker(s.ticker || [])).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    const [{ profile }, { jobs }, net] = await Promise.all([
      api<{ profile: ProfileLite }>("/api/profile"),
      api<{ jobs: Job[] }>("/api/jobs"),
      api<{ contacts: Contact[]; sentToday: number; cap: number }>("/api/contacts").catch(() => ({ contacts: [], sentToday: 0, cap: 10 })),
    ]);
    setContacts(net.contacts);
    setNetCap({ sentToday: net.sentToday, cap: net.cap });
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

  const pending = jobs.filter((j) => ["pending", "scoring", "to_tailor", "tailoring"].includes(j.status)).length;
  const unpacked = jobs.filter((j) => j.status === "tailored" && !j.applied && !j.apply_pack).length;
  const toAsk = contacts.filter((c) => c.status === "suggested").length;

  async function runApplier() {
    stopRef.current = false;
    setApplying("Starting…");
    let n = 0;
    try {
      while (!stopRef.current) {
        const r = await api<{ done: boolean; remaining: number; rate_limited?: boolean; job?: { title: string; route: string } }>("/api/applier/next", { method: "POST", body: "{}" });
        if (r.done) break;
        if (r.rate_limited) {
          setApplying(`AI limit reached, waiting a minute (${r.remaining} left)…`);
          await new Promise((res) => setTimeout(res, 60_000));
          continue;
        }
        n++;
        setApplying(`${n} ready, ${r.remaining} left${r.job ? `. Last: ${r.job.title} (${r.job.route === "referral_first" ? "referral first" : "apply directly"})` : ""}`);
        await load();
        await new Promise((res) => setTimeout(res, 5000));
      }
    } catch (e) {
      setApplying((e as Error).message);
      await new Promise((res) => setTimeout(res, 4000));
    }
    setApplying(null);
    load();
  }

  // Skills that would unlock the most potential jobs (wishlisted jobs count double).
  const unlocks = useMemo(() => {
    const m = new Map<string, { name: string; jobs: number; wish: number }>();
    for (const j of jobs) {
      if (j.status !== "stretch" || !j.analysis) continue;
      const gaps = j.analysis.key_gaps?.length ? j.analysis.key_gaps : (j.analysis.gaps || []).slice(0, 3);
      for (const g of gaps) {
        const k = g.toLowerCase().trim();
        if (!k) continue;
        const e = m.get(k) || { name: g.trim(), jobs: 0, wish: 0 };
        e.jobs++;
        if (j.wishlisted) e.wish++;
        m.set(k, e);
      }
    }
    return [...m.values()].sort((a, b) => b.jobs + b.wish - (a.jobs + a.wish)).slice(0, 8);
  }, [jobs]);

  async function runTailor() {
    stopRef.current = false;
    setTailoring("Starting…");
    let n = 0;
    let fails = 0;
    while (!stopRef.current) {
      let r: { done: boolean; remaining: number; rate_limited?: boolean; job?: { title: string; status: string; match_percent: number | null } };
      try {
        r = await api("/api/tailor/next", { method: "POST" });
        fails = 0;
      } catch (e) {
        // A slow or failed step shouldn't end the whole run: the server re-queues the job.
        if (++fails >= 3) {
          setTailoring((e as Error).message);
          await new Promise((res) => setTimeout(res, 4000));
          break;
        }
        setTailoring(`That step didn't finish (${(e as Error).message}). Trying the next one…`);
        await new Promise((res) => setTimeout(res, 5000));
        continue;
      }
      if (r.done) break;
      if (r.rate_limited) {
        setTailoring(`AI limit reached — waiting a minute (${r.remaining} left)…`);
        await new Promise((res) => setTimeout(res, 60_000));
        continue;
      }
      n++;
      const last = !r.job
        ? ""
        : r.job.status === "to_tailor"
        ? ` · ${r.job.title} looks like a match (${r.job.match_percent}%), tailoring next`
        : r.job.status === "retry_later"
        ? ` · ${r.job.title} was slow, will retry later`
        : ` · last: ${r.job.title} (${r.job.match_percent ?? "–"}%)`;
      setTailoring(`Step ${n} · ${r.remaining} left${last}`);
      await load();
      await new Promise((res) => setTimeout(res, 5000)); // stay under free-tier per-minute limits
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
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
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
        <AgentCard name="Applier" live detail={unpacked ? `${unpacked} tailored job${unpacked > 1 ? "s need" : " needs"} an apply pack` : `${jobs.filter((j) => j.status === "tailored" && !j.applied).length} ready to apply`}>
          {applying ? (
            <button className="btn-ghost w-full" onClick={() => (stopRef.current = true)}>Stop</button>
          ) : (
            <button className="btn-primary w-full" disabled={!unpacked} onClick={runApplier}>Prepare apply packs</button>
          )}
          {applying && <p className="text-xs text-muted mt-2">{applying}</p>}
        </AgentCard>
        <AgentCard name="Networker" live detail={`${netCap.sentToday} of ${netCap.cap} new people messaged today${toAsk ? `, ${toAsk} drafted and waiting` : ""}`}>
          <Link className="btn-ghost w-full" href="/network">Open Network</Link>
        </AgentCard>
      </div>

      <Tracker jobs={jobs} contacts={contacts} onReload={load} unlocks={unlocks} />
    </Shell>
  );
}

function AgentCard({ name, live, detail, children }: { name: string; live?: boolean; detail: string; children?: React.ReactNode }) {
  return (
    <div className={`card p-6 flex flex-col ${live ? "" : "opacity-60"}`}>
      <p className="text-xl font-bold tracking-tight mb-1">{name}</p>
      <p className="text-sm text-muted mb-4 flex-1">{detail}</p>
      {children}
    </div>
  );
}
