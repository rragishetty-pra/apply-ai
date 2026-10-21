"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/supabase-browser";
import { useAuth } from "@/components/useAuth";
import { Logo } from "@/components/Shell";
import PrefsForm from "@/components/PrefsForm";
import ExtensionConnect from "@/components/ExtensionConnect";
import { clearPendingRole, readPendingRole, withRole } from "@/lib/pending-role";
import { DEFAULT_PREFS, mergePrefs, type Prefs } from "@/lib/types";

interface Insights {
  full_name: string;
  phone: string;
  current_title: string;
  experience_years: number | null;
  target_roles: string[];
  key_skills: string[];
  locations: string[];
  current_employers: string[];
}

const STEPS = ["Your CV", "A few questions", "Connect Chrome", "Done"];

export default function Onboarding() {
  const { session } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [cv, setCv] = useState<{ filename: string; format: string } | null>(null);
  const [portalStatus, setPortalStatus] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!session) return;
    api<{ profile: { prefs: Prefs; cv_filename: string | null; cv_format: string | null; portal_status: Record<string, string> } }>("/api/profile").then(({ profile }) => {
      const merged = mergePrefs(profile.prefs);
      setPrefs({ ...merged, target_roles: withRole(merged.target_roles, readPendingRole()) });
      setPortalStatus(profile.portal_status || {});
      if (profile.cv_filename) setCv({ filename: profile.cv_filename, format: profile.cv_format || "" });
    });
  }, [session]);

  async function upload(file: File) {
    setErr(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await api<{ filename: string; format: string; insights: Insights | null }>("/api/profile/cv", { method: "POST", body: form });
      setCv({ filename: res.filename, format: res.format });
      const ins = res.insights;
      if (ins) {
        // Pre-fill answers from the CV; the user reviews them on the next step.
        setPrefs((p) => ({
          ...p,
          phone: p.phone || ins.phone || "",
          target_roles: p.target_roles.length > 1 ? p.target_roles : withRole([...p.target_roles, ...(ins.target_roles || [])].filter((r, k, a) => a.findIndex((x) => x.toLowerCase() === r.toLowerCase()) === k), readPendingRole()).slice(0, 4),
          key_skills: p.key_skills.length ? p.key_skills : ins.key_skills || [],
          experience_years: p.experience_years ?? ins.experience_years ?? null,
          locations: p.locations.length ? p.locations : ins.locations || [],
          exclude_companies: p.exclude_companies.length ? p.exclude_companies : ins.current_employers || [],
        }));
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function savePrefs(next: number, onboarded?: boolean) {
    setErr(null);
    if (!prefs.phone.replace(/[^\d]/g, "")) return setErr("Add your mobile number so companies can reach you.");
    if (!prefs.target_roles.length) return setErr("Add at least one job title to search for.");
    if (!prefs.portals.length) return setErr("Pick at least one portal for Hunter to search.");
    setSaving(true);
    try {
      await api("/api/profile", { method: "POST", body: JSON.stringify({ prefs, ...(onboarded ? { onboarded: true } : {}) }) });
      if (onboarded) {
        clearPendingRole();
        router.replace("/dashboard");
      }
      else setStep(next);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!session) return null;

  return (
    <div className="min-h-screen">
      <header className="mx-auto max-w-3xl px-4 h-16 flex items-center justify-between">
        <Logo />
        <span className="text-sm text-muted">{session.user.email}</span>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-20">
        <ol className="flex gap-2 mb-8">
          {STEPS.map((s, i) => (
            <li key={s} className="flex-1">
              <div className={`h-1.5 rounded-full transition-colors ${i <= step ? "bg-ink" : "bg-[#dcdbd6]"}`} />
              <p className={`text-xs mt-2 ${i === step ? "text-ink font-medium" : "text-muted"}`}>{s}</p>
            </li>
          ))}
        </ol>

        <div className="card p-6 sm:p-8">
          {step === 0 && (
            <div>
              <h1 className="display text-5xl mb-2">Start with your CV</h1>
              <p className="text-muted mb-6">
                A Word file (.docx) works best — Tailor edits your own file, so every tailored CV keeps your layout. PDFs work too, but you’ll get wording suggestions instead of ready files.
              </p>
              <div
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files?.[0];
                  if (f) upload(f);
                }}
                className="cursor-pointer rounded-[24px] border-2 border-dashed border-[#d6d5d0] hover:border-ink/40 hover:bg-card bg-paper p-10 text-center transition-colors"
              >
                {uploading ? (
                  <p className="text-muted">Reading your CV…</p>
                ) : cv ? (
                  <>
                    <p className="font-medium">{cv.filename}</p>
                    <p className="text-sm text-muted mt-1">Uploaded. Drop a new file to replace it.</p>
                  </>
                ) : (
                  <>
                    <p className="font-medium">Drop your CV here, or click to choose</p>
                    <p className="text-sm text-muted mt-1">.docx or .pdf, up to 5 MB</p>
                  </>
                )}
                <input ref={fileRef} type="file" accept=".docx,.pdf" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              </div>
              <div className="mt-6 flex justify-end">
                <button className="btn-primary" disabled={!cv || uploading} onClick={() => setStep(1)}>Continue</button>
              </div>
            </div>
          )}

          {step === 1 && (
            <div>
              <h1 className="display text-5xl mb-2">A few questions</h1>
              <p className="text-muted mb-8">We filled in what we could from your CV. Check it and change anything that’s off.</p>
              <PrefsForm prefs={prefs} onChange={setPrefs} email={session.user.email} />
              <div className="mt-8 flex justify-between">
                <button className="btn-ghost" onClick={() => setStep(0)}>Back</button>
                <button className="btn-primary" disabled={saving} onClick={() => savePrefs(2)}>{saving ? "Saving…" : "Continue"}</button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <h1 className="display text-5xl mb-2">Connect your Chrome</h1>
              <p className="text-muted mb-8">
                Hunter searches the job portals from your own Chrome, where you’re already signed in. This keeps your passwords private and your accounts safe.
              </p>
              <ExtensionConnect initialStatus={portalStatus} />
              <div className="mt-8 flex justify-between">
                <button className="btn-ghost" onClick={() => setStep(1)}>Back</button>
                <button className="btn-primary" onClick={() => setStep(3)}>Continue</button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="text-center py-6">
              <h1 className="display text-5xl mb-3">You’re set</h1>
              <p className="text-muted max-w-md mx-auto mb-8">
                Hunter will run{prefs.daily_run_hour !== null ? ` every day around ${((prefs.daily_run_hour + 11) % 12) + 1} ${prefs.daily_run_hour < 12 ? "AM" : "PM"}` : " when you click Run Hunter in the extension"}.
                Tailor follows straight after, and everything lands on your dashboard.
              </p>
              <button className="btn-accent px-6 py-3" disabled={saving} onClick={() => savePrefs(3, true)}>Go to my dashboard</button>
            </div>
          )}
          {err && <p className="text-sm text-rose mt-4">{err}</p>}
        </div>
      </main>
    </div>
  );
}
