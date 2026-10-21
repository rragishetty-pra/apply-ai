"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/supabase-browser";
import { INDUSTRIES } from "@/lib/portal-list";

interface Summary {
  total: number;
  byIndustry: Record<string, { total: number; searchable: number }>;
  mine: { id: string; name: string; industry: string | null; status: string; error: string | null }[];
}

const STATUS: Record<string, string> = {
  new: "Will be set up on the next Hunter run",
  resolved: "Searched every run",
  unsupported: "Careers site can't be searched automatically yet",
  failed: "Couldn't find its careers site",
};

/** Settings: which companies' careers pages Hunter covers, and adding more. */
export default function CompaniesCard() {
  const [s, setS] = useState<Summary | null>(null);
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState<string>(INDUSTRIES[0]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api<Summary>("/api/companies").then(setS).catch((e) => setMsg((e as Error).message));
  useEffect(() => {
    load();
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ company: { name: string }; existed: boolean }>("/api/companies", { method: "POST", body: JSON.stringify({ name, industry }) });
      setMsg(r.existed ? `${r.company.name} is already on the list.` : `Added ${r.company.name}. Hunter will find its careers site on the next run.`);
      setName("");
      load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const searchable = s ? Object.values(s.byIndustry).reduce((n, x) => n + x.searchable, 0) : 0;

  return (
    <div className="card p-6">
      <p className="display text-2xl mb-2">Company careers pages</p>
      {s ? (
        <p className="text-sm text-muted mb-4">
          {s.total} leading employers across {Object.keys(s.byIndustry).length} industries.{" "}
          {searchable ? `${searchable} are set up and searched every run; the rest are set up a few at a time as Hunter runs.` : "Hunter sets them up a few at a time as it runs."}
        </p>
      ) : (
        <p className="text-sm text-muted mb-4">Loading…</p>
      )}
      <form onSubmit={add} className="space-y-2">
        <label className="label" htmlFor="co-name">Add a company</label>
        <input id="co-name" className="input" placeholder="e.g. Ford Motor Company" value={name} onChange={(e) => setName(e.target.value)} />
        <select className="input" value={industry} onChange={(e) => setIndustry(e.target.value)} aria-label="Industry">
          {INDUSTRIES.map((i) => <option key={i}>{i}</option>)}
        </select>
        <button className="btn-ghost w-full" disabled={busy || name.trim().length < 2}>{busy ? "Adding…" : "Add company"}</button>
      </form>
      {msg && <p className="text-xs text-muted mt-2">{msg}</p>}
      {!!s?.mine.length && (
        <ul className="mt-4 space-y-2">
          {s.mine.map((c) => (
            <li key={c.id} className="text-sm">
              <span className="font-semibold">{c.name}</span>
              <span className="block text-xs text-muted">{STATUS[c.status] || c.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
