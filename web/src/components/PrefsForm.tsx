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
        className={`relative h-6 w-10 rounded-full border-2 border-ink transition ${checked ? "bg-accent" : "bg-line"}`}
        onClick={() => onChange(!checked)}
      >
        <span className={`absolute top-0 h-5 w-5 rounded-full bg-white border-2 border-ink transition-all ${checked ? "left-[16px]" : "left-0"}`} />
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

export default function PrefsForm({ prefs, onChange }: { prefs: Prefs; onChange: (p: Prefs) => void }) {
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => onChange({ ...prefs, [k]: v });

  return (
    <div className="space-y-8">
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
          <input type="range" min={50} max={90} step={5} value={prefs.match_threshold} onChange={(e) => set("match_threshold", Number(e.target.value))} className="w-full accent-[#ff4d8d]" />
          <p className="hint">Jobs a little below this are kept as “stretch” jobs with the skills they ask for, so you know what to learn.</p>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="display text-2xl">Hunter’s schedule</h3>
        <div>
          <span className="label">Portals to search</span>
          <div className="flex flex-wrap gap-2">
            {PORTALS.map((p) => {
              const on = prefs.portals.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => set("portals", on ? prefs.portals.filter((x) => x !== p.id) : [...prefs.portals, p.id])}
                  className={`chip px-4 py-1.5 text-sm border-2 ${on ? "bg-ink text-white border-ink shadow-[2px_2px_0_var(--color-accent)]" : "bg-card border-ink/30 text-muted"}`}
                >
                  {p.name}
                </button>
              );
            })}
          </div>
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
