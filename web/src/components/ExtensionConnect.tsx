"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/supabase-browser";

type LoginState = Record<string, string>;

const PORTALS = [
  { id: "naukri", name: "Naukri", login: "https://www.naukri.com/nlogin/login" },
  { id: "linkedin", name: "LinkedIn", login: "https://www.linkedin.com/login" },
  { id: "indeed", name: "Indeed", login: "https://secure.indeed.com/auth" },
];

/** Talks to the Apply.ai Chrome extension through window.postMessage (its content script listens on this site). */
export function ask<T>(type: string, payload: Record<string, unknown> = {}, timeoutMs = 90_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2);
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window || e.data?.source !== "applyai-ext" || e.data?.id !== id) return;
      window.removeEventListener("message", onMsg);
      clearTimeout(timer);
      if (e.data.error) reject(new Error(e.data.error));
      else resolve(e.data.result as T);
    };
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMsg);
      reject(new Error("The extension didn't answer. Reload this page and try again."));
    }, timeoutMs);
    window.addEventListener("message", onMsg);
    window.postMessage({ source: "applyai-web", id, type, ...payload }, window.location.origin);
  });
}

export function useExtension() {
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    let alive = true;
    let found = false;
    const check = async () => {
      if (found) return;
      if (document.documentElement.dataset.applyaiExtension === "1") found = true;
      else found = await ask("PING", {}, 1200).then(() => true, () => false);
      if (alive && found) setInstalled(true);
    };
    check();
    const t = setInterval(check, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return installed;
}

export default function ExtensionConnect({ initialStatus = {}, compact = false }: { initialStatus?: LoginState; compact?: boolean }) {
  const installed = useExtension();
  const [paired, setPaired] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [logins, setLogins] = useState<LoginState>(initialStatus);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!installed) return;
    ask<{ paired: boolean }>("STATUS", {}, 5000).then((r) => setPaired(r.paired)).catch(() => {});
  }, [installed]);

  const pair = useCallback(async () => {
    setErr(null);
    setBusy("pair");
    try {
      const { token } = await api<{ token: string }>("/api/extension/pair", { method: "POST" });
      await ask("PAIR", { token, apiBase: window.location.origin }, 10_000);
      setPaired(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, []);

  const checkLogins = useCallback(async () => {
    setErr(null);
    setBusy("logins");
    try {
      setLogins(await ask<LoginState>("CHECK_LOGINS"));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, []);

  return (
    <div className="space-y-5">
      <ol className="space-y-4">
        <Step n={1} done={installed} title="Add the Apply.ai extension to Chrome">
          {installed ? (
            <p className="text-sm text-muted">Extension detected.</p>
          ) : (
            <div className="text-sm text-muted space-y-1">
              <p>During the beta, install it from the folder your invite came with:</p>
              <p>Chrome → <code className="bg-paper px-1 rounded">chrome://extensions</code> → turn on <b>Developer mode</b> → <b>Load unpacked</b> → pick the <code className="bg-paper px-1 rounded">extension</code> folder. Then reload this page.</p>
            </div>
          )}
        </Step>

        <Step n={2} done={paired} title="Connect it to your account">
          <button className="btn-primary" disabled={!installed || busy === "pair"} onClick={pair}>
            {busy === "pair" ? "Connecting…" : paired ? "Reconnect" : "Connect extension"}
          </button>
        </Step>

        <Step n={3} done={PORTALS.some((p) => logins[p.id] === "ok")} title="Sign in to your job portals in this Chrome">
          {!compact && (
            <p className="text-sm text-muted mb-3">
              Sign in the normal way — Apply.ai never sees or stores your passwords. Hunter uses your signed-in Chrome, just like you would.
            </p>
          )}
          <div className="flex flex-wrap gap-2 mb-3">
            {PORTALS.map((p) => (
              <a key={p.id} href={p.login} target="_blank" rel="noreferrer" className="btn-ghost py-1.5">
                <StatusDot state={logins[p.id]} /> {p.name}
              </a>
            ))}
          </div>
          <button className="btn-ghost" disabled={!paired || busy === "logins"} onClick={checkLogins}>
            {busy === "logins" ? "Checking (opens tabs briefly)…" : "Check my sign-ins"}
          </button>
          <p className="hint">Indeed works without signing in; Naukri and LinkedIn show more jobs when you’re signed in.</p>
        </Step>
      </ol>
      {err && <p className="text-sm text-rose">{err}</p>}
    </div>
  );
}

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className={`mt-0.5 h-7 w-7 shrink-0 rounded-full grid place-items-center text-sm font-bold ${done ? "bg-ink text-white" : "bg-mist text-muted"}`}>
        {done ? "✓" : n}
      </span>
      <div className="flex-1">
        <p className="font-medium mb-2">{title}</p>
        {children}
      </div>
    </li>
  );
}

function StatusDot({ state }: { state?: string }) {
  const color = state === "ok" ? "bg-accent" : state === "login_needed" ? "bg-[#c4a067]" : "bg-[#cfcec9]";
  return <span className={`h-2.5 w-2.5 rounded-full ${color}`} title={state === "ok" ? "Signed in" : state === "login_needed" ? "Sign-in needed" : "Not checked"} />;
}
