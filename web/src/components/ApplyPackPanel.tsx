"use client";
import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/supabase-browser";
import { ask, useExtension } from "@/components/ExtensionConnect";
import type { Contact, Job } from "@/lib/types";
import { prepareApplyPack } from "@/lib/apply-pack-client";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn-ghost py-1 px-3 text-xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {}
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

export function routeLabel(job: Job): { text: string; tone: string } | null {
  if (!job.apply_pack || job.applied) return null;
  if (job.apply_route === "referral_first") {
    const until = job.referral_wait_until ? new Date(job.referral_wait_until) : null;
    if (until && until.getTime() > Date.now()) {
      return { text: `Referral first, apply by ${until.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`, tone: "bg-amber-soft text-amber" };
    }
    return { text: "Apply directly now", tone: "bg-accent-soft text-accent" };
  }
  return { text: "Apply directly", tone: "bg-accent-soft text-accent" };
}

export default function ApplyPackPanel({
  job,
  contacts,
  onChanged,
}: {
  job: Job;
  contacts: Contact[];
  onChanged: () => void;
}) {
  const extension = useExtension();
  const pack = job.apply_pack;
  const [answers, setAnswers] = useState<Record<string, string>>(
    Object.fromEntries((pack?.needs_you || []).map((n) => [n.key, n.answer || ""]))
  );
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function prepare() {
    setBusy("prepare");
    setMsg("Applier is checking how this company hires and preparing your pack…");
    try {
      if (pack) await api(`/api/jobs/${job.id}`, { method: "PATCH", body: JSON.stringify({ reprepare: true }) });
      const problem = await prepareApplyPack(job.id, setMsg);
      setMsg(problem);
      onChanged();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function saveAnswers() {
    setBusy("answers");
    try {
      await api(`/api/jobs/${job.id}`, { method: "PATCH", body: JSON.stringify({ needs_answers: answers, remember }) });
      setMsg(remember ? "Saved. Applier will reuse these answers in future packs." : "Saved for this job.");
      onChanged();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function findPeople() {
    setBusy("people");
    setMsg("Networker is looking for people at this company on LinkedIn, in a background window. About a minute…");
    try {
      const r = await ask<{ added: number; reason: string | null; seen: number }>(
        "FIND_PEOPLE",
        { jobId: job.id, company: job.company, role: job.title },
        240_000
      );
      setMsg(
        r.added
          ? `Found ${r.added} ${r.added > 1 ? "people" : "person"} to ask, with messages drafted. See them below or on the Network page.`
          : r.reason === "cap"
          ? "You've reached today's limit of new people. Networker will pick up tomorrow."
          : `Couldn't find people who currently work at ${job.company} on LinkedIn.`
      );
      onChanged();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!pack) {
    return (
      <div className="rounded-[22px] bg-paper p-5">
        <p className="font-semibold mb-1">Apply pack</p>
        <p className="text-sm text-muted mb-3">
          Applier checks whether {job.company || "this company"} favours referrals and gets your cover note and form answers ready.
        </p>
        <button className="btn-primary py-2" disabled={!!busy} onClick={prepare}>
          {busy ? "Preparing…" : "Prepare apply pack"}
        </button>
        {msg && <p className="text-xs text-muted mt-2">{msg}</p>}
      </div>
    );
  }

  const waiting = job.apply_route === "referral_first" && job.referral_wait_until && new Date(job.referral_wait_until).getTime() > Date.now();
  const referred = contacts.some((c) => c.status === "referred");
  const openNeeds = (pack.needs_you || []).filter((n) => !(answers[n.key] || "").trim()).length;

  return (
    <div className="space-y-5">
      {/* Route */}
      <div className="rounded-[22px] bg-paper p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <p className="font-semibold">
            {job.apply_route === "referral_first" ? (referred ? "Referral received" : waiting ? "Try for a referral first" : "Apply directly now") : "Apply directly"}
          </p>
          <div className="flex flex-wrap gap-2">
            {waiting && !referred && (
              <button className="btn-ghost py-1.5" onClick={async () => { await api(`/api/jobs/${job.id}`, { method: "PATCH", body: JSON.stringify({ apply_now: true }) }); onChanged(); }}>
                Skip the wait
              </button>
            )}
            <button className="btn-ghost py-1.5" disabled={!!busy} onClick={prepare}>{busy === "prepare" ? "Preparing…" : "Prepare again"}</button>
          </div>
        </div>
        <p className="text-sm">{pack.route_reason}</p>
        {!!pack.company_notes?.length && (
          <ul className="list-disc pl-5 text-sm text-muted mt-2 space-y-0.5">{pack.company_notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        )}
        {job.apply_route === "referral_first" && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted">
              {contacts.length
                ? `${contacts.length} ${contacts.length > 1 ? "people" : "person"} to ask, ${contacts.filter((c) => c.sent_at).length} messaged`
                : "No one to ask yet."}
            </span>
            {extension ? (
              <button className="btn-primary py-1.5" disabled={!!busy} onClick={findPeople}>
                {busy === "people" ? "Finding people…" : contacts.length ? "Find more people" : "Find people to ask"}
              </button>
            ) : (
              <Link className="btn-ghost py-1.5" href="/settings">Connect the extension to find people</Link>
            )}
            {contacts.length > 0 && <Link className="btn-ghost py-1.5" href={`/network?job=${job.id}`}>Open in Network</Link>}
          </div>
        )}
      </div>

      {/* Needs you */}
      {!!pack.needs_you?.length && (
        <div className="rounded-[22px] bg-amber-soft/60 p-5">
          <p className="font-semibold mb-1">Needs your answer{openNeeds ? ` (${openNeeds} left)` : ""}</p>
          <p className="text-sm text-muted mb-4">Applier won&apos;t fill these in for you. They can change how a recruiter reads your application.</p>
          <div className="space-y-4">
            {pack.needs_you.map((n) => (
              <div key={n.key}>
                <label className="label mb-1" htmlFor={`n-${job.id}-${n.key}`}>{n.question}</label>
                <p className="text-xs text-muted mb-1.5">{n.why}</p>
                <input
                  id={`n-${job.id}-${n.key}`}
                  className="input"
                  value={answers[n.key] || ""}
                  onChange={(e) => setAnswers({ ...answers, [n.key]: e.target.value })}
                />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-4 mt-4">
            <button className="btn-primary py-2" disabled={busy === "answers"} onClick={saveAnswers}>{busy === "answers" ? "Saving…" : "Save answers"}</button>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 accent-[#1d1d1f]" />
              Use these for future applications too
            </label>
          </div>
        </div>
      )}

      {/* Ready answers */}
      {!!pack.answers?.length && (
        <div>
          <p className="font-semibold mb-2">Ready to paste</p>
          <ul className="divide-y divide-line rounded-[22px] bg-paper">
            {pack.answers.map((a, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-xs text-muted">{a.question}</p>
                  <p className="text-sm font-medium break-words">{a.answer}</p>
                </div>
                <CopyButton text={a.answer} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Cover note */}
      {pack.cover_note && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="font-semibold">Cover note</p>
            <CopyButton text={pack.cover_note} />
          </div>
          <p className="rounded-[22px] bg-paper px-4 py-3 text-sm leading-relaxed whitespace-pre-line">{pack.cover_note}</p>
        </div>
      )}

      {/* Where + checklist */}
      <div className="grid sm:grid-cols-2 gap-5">
        <div>
          <p className="font-semibold mb-2">Where to apply</p>
          <div className="flex flex-wrap gap-2">
            {pack.where.map((w) => (
              <a key={w.url} href={w.url} target="_blank" rel="noopener noreferrer" className="btn-ghost py-1.5">{w.label}</a>
            ))}
          </div>
        </div>
        {!!pack.checklist?.length && (
          <div>
            <p className="font-semibold mb-2">Before you submit</p>
            <ol className="list-decimal pl-5 text-sm space-y-1">{pack.checklist.map((c, i) => <li key={i}>{c}</li>)}</ol>
          </div>
        )}
      </div>
      {msg && <p className="text-xs text-muted">{msg}</p>}
    </div>
  );
}
