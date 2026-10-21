"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/supabase-browser";
import { useAuth } from "@/components/useAuth";
import Shell from "@/components/Shell";
import PrefsForm from "@/components/PrefsForm";
import ExtensionConnect from "@/components/ExtensionConnect";
import CompaniesCard from "@/components/CompaniesCard";
import { mergePrefs, type Prefs } from "@/lib/types";

export default function Settings() {
  const { session } = useAuth();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [cv, setCv] = useState<string | null>(null);
  const [portalStatus, setPortalStatus] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!session) return;
    api<{ profile: { prefs: Prefs; cv_filename: string | null; portal_status: Record<string, string> } }>("/api/profile").then(({ profile }) => {
      setPrefs(mergePrefs(profile.prefs));
      setCv(profile.cv_filename);
      setPortalStatus(profile.portal_status || {});
    });
  }, [session]);

  async function save() {
    if (!prefs) return;
    setBusy(true);
    try {
      await api("/api/profile", { method: "POST", body: JSON.stringify({ prefs }) });
      setMsg("Saved. Hunter uses these from its next run.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function replaceCv(file: File) {
    setMsg("Uploading…");
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await api<{ filename: string }>("/api/profile/cv", { method: "POST", body: form });
      setCv(r.filename);
      setMsg("CV replaced. New tailored CVs will use it.");
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function disconnect() {
    if (!confirm("Disconnect every Chrome extension linked to your account?")) return;
    await api("/api/extension/pair", { method: "DELETE" });
    setMsg("Extensions disconnected. Connect again below when you're ready.");
  }

  if (!prefs) return <Shell><p className="text-muted">Loading…</p></Shell>;

  return (
    <Shell>
      <h1 className="display text-4xl mb-8">Settings</h1>
      <div className="grid lg:grid-cols-[1fr_380px] gap-6 items-start">
        <div className="card p-6 sm:p-8">
          <PrefsForm prefs={prefs} onChange={setPrefs} email={session?.user.email} />
          <div className="mt-8 flex items-center gap-4">
            <button className="btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save changes"}</button>
            {msg && <p className="text-sm text-muted">{msg}</p>}
          </div>
        </div>

        <div className="space-y-6">
          <div className="card p-6">
            <p className="display text-2xl mb-2">Your CV</p>
            <p className="text-sm text-muted mb-4">{cv || "No CV uploaded"}</p>
            <button className="btn-ghost w-full" onClick={() => fileRef.current?.click()}>Replace CV</button>
            <input ref={fileRef} type="file" accept=".docx,.pdf" hidden onChange={(e) => e.target.files?.[0] && replaceCv(e.target.files[0])} />
          </div>
          <CompaniesCard />
          <div className="card p-6">
            <p className="display text-2xl mb-4">Chrome extension</p>
            <ExtensionConnect initialStatus={portalStatus} portals={prefs.portals} compact />
            <button className="text-sm text-rose mt-5" onClick={disconnect}>Disconnect all extensions</button>
          </div>
        </div>
      </div>
    </Shell>
  );
}
