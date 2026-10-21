"use client";
import { useState } from "react";
import type { Prefs } from "@/lib/types";

/** Comma-separated list input that keeps the user's typing intact until blur. */
function ListInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [text, setText] = useState(value.join(", "));
  return (
    <input
      className="input"
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onChange(text.split(",").map((s) => s.trim()).filter(Boolean))}
    />
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none">
      <span
        className={`relative h-6 w-11 rounded-full transition-colors ${checked ? "bg-ink" : "bg-[#d6d5d0]"}`}
        onClick={() => onChange(!checked)}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
      </span>
      <span className="text-sm">{label}</span>
    </label>
  );
}

const PORTALS: { id: Prefs["portals"][number]; name: string }[] = [
  { id: "naukri", name: "Naukri" },
  { id: "linkedin", name: "LinkedIn" },
  { id: "indeed", name: "Indeed" },
];

export default function PrefsForm({ prefs, onChange, email }: { prefs: Prefs; onChange: (p: Prefs) => void; email?: string | null }) {
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => onChange({ ...prefs, [k]: v });

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h3 className="display text-2xl">How companies reach you</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="phone">Mobile number</label>
            <input
              id="phone"
              className="input"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+91 98765 43210"
              value={prefs.phone}
              onChange={(e) => set("phone", e.target.value)}
            />
          </div>
          <div>
            <span className="label">Email</span>
            <p className="rounded-2xl bg-mist px-4 py-3 text-[15px] truncate" title={email || ""}>{email || "Your sign-in email"}</p>
          </div>
        </div>
        <p className="hint">We use your sign-in email and this number whenever an application asks for contact details.</p>
      </section>

      <section className="space-y-4">
        <h3 className="display text-2xl">What are you looking for?</h3>
        <div>
          <label className="label">Job titles to search</label>
          <ListInput value={prefs.target_roles} onChange={(v) => set("target_roles", v)} placeholder="e.g. ETL Test Lead, Senior Data QA Engineer" />
          <p className="hint">Up to 3 are searched on each portal. Separate with commas.</p>
        </div>
        <div>
          <label className="label">Your key skills</label>
          <ListInput value={prefs.key_skills} onChange={(v) => set("key_skills", v)} placeholder="e.g. SQL, Informatica, Data warehouse testing" />
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Total experience (years)</label>
            <input className="input" type="number" min={0} max={50} value={prefs.experience_years ?? ""} onChange={(e) => set("experience_years", e.target.value === "" ? null : Number(e.target.value))} />
          </div>
          <div>
            <label className="label">Notice period (days)</label>
            <input className="input" type="number" min={0} max={180} value={prefs.notice_period_days ?? ""} onChange={(e) => set("notice_period_days", e.target.value === "" ? null : Number(e.target.value))} />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="display text-2xl">Where?</h3>
        <div>
          <label className="label">Cities</label>
          <ListInput value={prefs.locations} onChange={(v) => set("locations", v)} placeholder="e.g. Hyderabad, Bengaluru" />
        </div>
        <Toggle checked={prefs.remote_ok} onChange={(v) => set("remote_ok", v)} label="Include remote jobs in India" />
        <Toggle checked={prefs.abroad_ok} onChange={(v) => set("abroad_ok", v)} label="Open to relocating abroad (with sponsorship)" />
        {prefs.abroad_ok && (
          <div>
            <label className="label">Countries</label>
            <ListInput value={prefs.abroad_countries} onChange={(v) => set("abroad_countries", v)} placeholder="Leave empty for any country" />
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h3 className="display text-2xl">Your rules</h3>
        <div>
          <label className="label">Never show jobs from</label>
          <ListInput value={prefs.exclude_companies} onChange={(v) => set("exclude_companies", v)} placeholder="e.g. your current and past employers" />
        </div>
        <div>
          <label className="label">Tailor a CV when the match is at least {prefs.match_threshold}%</label>
          <input type="range" min={50} max={90} step={5} value={prefs.match_threshold} onChange={(e) => set("match_threshold", Number(e.target.value))} className="w-full accent-[#1d1d1f]" />
          <p className="hint">Jobs a little below this are kept as “stretch” jobs with the skills they ask for, so you know what to learn.</p>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="display text-2xl">Hunter’s schedule</h3>
        <div>
          <span className="label" id="portals-label">Portals to search</span>
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby="portals-label">
            {PORTALS.map((p) => {
              const on = prefs.portals.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set("portals", on ? prefs.portals.filter((x) => x !== p.id) : [...prefs.portals, p.id])}
                  className={`inline-flex items-center gap-2 rounded-full pl-3 pr-4 py-2 text-sm font-semibold transition-colors ${
                    on ? "bg-ink text-white" : "bg-card text-muted ring-1 ring-line hover:text-ink hover:ring-ink/30"
                  }`}
                >
                  <span className={`grid h-5 w-5 place-items-center rounded-full ${on ? "bg-white text-ink" : "ring-1 ring-[#cfcec9]"}`} aria-hidden>
                    {on && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                        <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  {p.name}
                </button>
              );
            })}
          </div>
          <p className="hint">
            {prefs.portals.length
              ? `Hunter will search ${prefs.portals.length} portal${prefs.portals.length > 1 ? "s" : ""}. Tap a portal to turn it on or off.`
              : "Pick at least one portal for Hunter to search."}
          </p>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Run every day at</label>
            <select className="input" value={prefs.daily_run_hour ?? ""} onChange={(e) => set("daily_run_hour", e.target.value === "" ? null : Number(e.target.value))}>
              <option value="">Only when I click “Run Hunter”</option>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{`${((h + 11) % 12) + 1}:00 ${h < 12 ? "AM" : "PM"}`}</option>
              ))}
            </select>
            <p className="hint">Chrome must be open at that time.</p>
          </div>
          <div>
            <label className="label">Job pages to read per run</label>
            <input className="input" type="number" min={5} max={80} value={prefs.max_jobs_per_run} onChange={(e) => set("max_jobs_per_run", Number(e.target.value))} />
            <p className="hint">Lower is gentler on your portal accounts.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
