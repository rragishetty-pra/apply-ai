"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/supabase-browser";
import { useAuth } from "@/components/useAuth";
import Shell from "@/components/Shell";
import { ask, useExtension } from "@/components/ExtensionConnect";
import type { Achievement, AchievementKind } from "@/lib/types";

const KIND_LABEL: Record<AchievementKind, string> = {
  certification: "Certification",
  award: "Award",
  appreciation: "Appreciation",
  recommendation: "Recommendation",
  other: "Other",
};
const KINDS = Object.keys(KIND_LABEL) as AchievementKind[];

const EMPTY = { kind: "certification" as AchievementKind, title: "", issuer: "", date_text: "", description: "", url: "" };

export default function Achievements() {
  const { session } = useAuth();
  const extension = useExtension();
  const [list, setList] = useState<Achievement[] | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [postUrl, setPostUrl] = useState("");

  const load = useCallback(async () => {
    const { achievements } = await api<{ achievements: Achievement[] }>("/api/achievements");
    setList(achievements);
  }, []);

  useEffect(() => {
    if (session) load().catch((e) => setMsg((e as Error).message));
  }, [session, load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy("save");
    setMsg(null);
    try {
      if (editing) await api(`/api/achievements/${editing}`, { method: "PATCH", body: JSON.stringify(form) });
      else await api("/api/achievements", { method: "POST", body: JSON.stringify(form) });
      setForm(EMPTY);
      setEditing(null);
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function scan() {
    setBusy("scan");
    setMsg("Starting the scan…");
    const started = Date.now();
    // Show what the extension is doing while it reads LinkedIn in the background.
    const tick = setInterval(async () => {
      const secs = Math.round((Date.now() - started) / 1000);
      const p = await ask<{ text: string } | null>("SCAN_PROGRESS", {}, 3000).catch(() => null);
      setMsg(`${p?.text || "Working…"} (${secs}s)`);
    }, 2000);
    try {
      const r = await ask<{ found: number; read: number }>("SCAN_LINKEDIN", {}, 180_000);
      setMsg(
        r.found
          ? `Found ${r.found} new item${r.found > 1 ? "s" : ""} on LinkedIn. Check them below and keep the ones that are right.`
          : r.read
          ? "Nothing new on LinkedIn: everything it found is already listed on the right. If a post is missing, paste its link below."
          : "We couldn't find certifications, honours or recommendations on your LinkedIn profile. If you can see them there, tell us, as LinkedIn may have changed its pages."
      );
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      clearInterval(tick);
      setBusy(null);
    }
  }

  async function readPost(e: React.FormEvent) {
    e.preventDefault();
    setBusy("post");
    setMsg("Reading that post and its certificate image…");
    try {
      const r = await ask<{ found: number }>("READ_POST", { url: postUrl.trim() }, 120_000);
      setMsg(r.found ? "Got it. Check the new item on the right and keep it if it's right." : "Read the post, but didn't find an achievement in it (or it's already in your list).");
      setPostUrl("");
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function confirm(id: string) {
    await api(`/api/achievements/${id}`, { method: "PATCH", body: JSON.stringify({ status: "confirmed" }) });
    load();
  }
  async function remove(id: string) {
    await api(`/api/achievements/${id}`, { method: "DELETE" });
    if (editing === id) {
      setEditing(null);
      setForm(EMPTY);
    }
    load();
  }
  function edit(a: Achievement) {
    setEditing(a.id);
    setForm({
      kind: a.kind,
      title: a.title,
      issuer: a.issuer || "",
      date_text: a.date_text || "",
      description: a.description || "",
      url: a.url || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const suggested = (list || []).filter((a) => a.status === "suggested");
  const confirmed = (list || []).filter((a) => a.status === "confirmed");

  return (
    <Shell>
      <div className="mb-8 max-w-2xl">
        <h1 className="display text-4xl sm:text-5xl mb-3">Achievements</h1>
        <p className="text-muted leading-relaxed">
          Certifications, awards and appreciation from your current and past companies. Tailor uses these to strengthen
          your CVs, and Coach turns them into interview stories.
        </p>
      </div>

      <div className="grid lg:grid-cols-[400px_1fr] gap-6 items-start">
        {/* Add / edit */}
        <div className="space-y-6 lg:sticky lg:top-24">
          <form onSubmit={save} className="card p-6 space-y-4">
            <p className="text-xl font-bold tracking-tight">{editing ? "Edit achievement" : "Add one yourself"}</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Type">
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={form.kind === k}
                  onClick={() => setForm({ ...form, kind: k })}
                  className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                    form.kind === k ? "bg-ink text-white" : "bg-mist text-muted hover:text-ink"
                  }`}
                >
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
            <div>
              <label className="label" htmlFor="a-title">Title</label>
              <input id="a-title" className="input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder={form.kind === "certification" ? "e.g. Azure Data Engineer Associate" : form.kind === "award" ? "e.g. Star Performer of the Quarter" : "e.g. Client appreciation for go-live"} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="a-issuer">{form.kind === "certification" ? "Issued by" : "Company"}</label>
                <input id="a-issuer" className="input" value={form.issuer} onChange={(e) => setForm({ ...form, issuer: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="a-date">When</label>
                <input id="a-date" className="input" placeholder="Mar 2024" value={form.date_text} onChange={(e) => setForm({ ...form, date_text: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="a-desc">What it was for</label>
              <textarea id="a-desc" className="input min-h-24" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="One or two lines. For appreciation, say who gave it and why." />
            </div>
            <div>
              <label className="label" htmlFor="a-url">Link (optional)</label>
              <input id="a-url" className="input" type="url" placeholder="Credential or post URL" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
            </div>
            <div className="flex gap-2">
              <button className="btn-primary" disabled={busy === "save"}>{busy === "save" ? "Saving…" : editing ? "Save changes" : "Add achievement"}</button>
              {editing && (
                <button type="button" className="btn-ghost" onClick={() => { setEditing(null); setForm(EMPTY); }}>Cancel</button>
              )}
            </div>
          </form>

          <div className="card p-6">
            <p className="text-xl font-bold tracking-tight mb-2">Find them on LinkedIn</p>
            <p className="text-sm text-muted mb-4 leading-relaxed">
              We read your own LinkedIn certifications, honours, recommendations and your posts (including certificate images), in a
              background window of your Chrome. Usually under a minute. You choose what to keep.
            </p>
            {extension ? (
              <button className="btn-primary w-full" disabled={busy === "scan"} onClick={scan}>
                {busy === "scan" ? "Scanning LinkedIn…" : "Scan my LinkedIn"}
              </button>
            ) : (
              <a className="btn-ghost w-full" href="/settings">Connect the Chrome extension first</a>
            )}
            {extension && (
              <form onSubmit={readPost} className="mt-5 pt-5 border-t border-line space-y-2">
                <label className="label" htmlFor="post-url">Missing one? Paste the post link</label>
                <p className="text-xs text-muted">
                  LinkedIn doesn&apos;t list every older post in your activity. Open the post, click ⋯ → Copy link to post, and paste it here.
                </p>
                <input
                  id="post-url"
                  className="input"
                  placeholder="https://www.linkedin.com/posts/…"
                  value={postUrl}
                  onChange={(e) => setPostUrl(e.target.value)}
                />
                <button className="btn-ghost w-full" disabled={busy === "post" || !/linkedin\.com\/(posts|feed\/update)\//.test(postUrl)}>
                  {busy === "post" ? "Reading post…" : "Read this post"}
                </button>
              </form>
            )}
          </div>
          {msg && <p className="text-sm text-muted px-1">{msg}</p>}
        </div>

        {/* Lists */}
        <div className="space-y-8">
          {suggested.length > 0 && (
            <section>
              <h2 className="text-lg font-bold mb-3">Found on LinkedIn <span className="text-muted font-medium">(keep the ones that are right)</span></h2>
              <ul className="space-y-3">
                {suggested.map((a) => (
                  <Item key={a.id} a={a}>
                    <button className="btn-primary py-1.5" onClick={() => confirm(a.id)}>Keep</button>
                    <button className="btn-ghost py-1.5" onClick={() => edit(a)}>Edit</button>
                    <button className="btn-ghost py-1.5" onClick={() => remove(a.id)}>Discard</button>
                  </Item>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2 className="text-lg font-bold mb-3">Your achievements</h2>
            {list === null ? (
              <p className="text-muted">Loading…</p>
            ) : confirmed.length === 0 ? (
              <div className="card p-8 text-center text-muted">
                Nothing here yet. Add a certification or award on the left, or scan your LinkedIn.
              </div>
            ) : (
              <ul className="space-y-3">
                {confirmed.map((a) => (
                  <Item key={a.id} a={a}>
                    <button className="btn-ghost py-1.5" onClick={() => edit(a)}>Edit</button>
                    <button className="btn-ghost py-1.5" onClick={() => remove(a.id)}>Delete</button>
                  </Item>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </Shell>
  );
}

function Item({ a, children }: { a: Achievement; children: React.ReactNode }) {
  return (
    <li className="card p-5 flex flex-wrap items-start gap-4">
      <div className="flex-1 min-w-[220px]">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className="chip bg-mist text-muted">{KIND_LABEL[a.kind]}</span>
          {a.source === "linkedin" && <span className="chip bg-mist text-muted">From LinkedIn</span>}
        </div>
        <p className="font-semibold text-lg leading-snug">{a.title}</p>
        <p className="text-sm text-muted">{[a.issuer, a.date_text].filter(Boolean).join(", ")}</p>
        {a.description && <p className="text-sm mt-2 leading-relaxed">{a.description}</p>}
        {a.url && (
          <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold underline underline-offset-4 mt-2 inline-block">
            View credential
          </a>
        )}
      </div>
      <div className="flex gap-2">{children}</div>
    </li>
  );
}
