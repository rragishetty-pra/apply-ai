"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { Logo } from "@/components/Shell";

/** Always send people back to the main app address, even if they opened a deployment-specific URL. */
function appOrigin() {
  const env = process.env.NEXT_PUBLIC_APP_URL;
  if (env && !env.includes("localhost")) return env.replace(/\/$/, "");
  return window.location.origin;
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(
    params.get("expired") ? "That sign-in link has expired or was already used. Get a new one below — or use the code from the email." : null
  );

  useEffect(() => {
    const sb = supabaseBrowser();
    sb.auth.getSession().then(({ data }) => data.session && router.replace("/dashboard"));
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => s && router.replace("/dashboard"));
    return () => sub.subscription.unsubscribe();
  }, [router]);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setErr(null);
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${appOrigin()}/dashboard` },
    });
    setBusy(false);
    if (error) setErr(error.message);
    else setSent(true);
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { error } = await supabaseBrowser().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error) setErr(error.message.includes("expired") ? "That code has expired or was already used. Send a new one." : error.message);
    else router.replace("/dashboard");
  }

  return (
    <div
      className="min-h-screen grid place-items-center px-4 bg-grape"
      style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.18) 1.2px, transparent 1.4px)", backgroundSize: "22px 22px" }}
    >
      <div className="w-full max-w-sm">
        <div className="text-center mb-8"><Logo light /></div>
        <div className="card p-7">
          {sent ? (
            <form onSubmit={verify} className="space-y-4">
              <div>
                <p className="display text-3xl mb-2">Check your email</p>
                <p className="text-sm text-muted">
                  We sent a sign-in email to <b>{email}</b>. Click the link in it, or type the code from the email here.
                </p>
              </div>
              <input
                className="input text-center text-2xl font-bold tracking-[0.4em]"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                maxLength={10}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
              <button className="btn-primary w-full" disabled={busy || code.length < 6}>{busy ? "Checking…" : "Sign in with code"}</button>
              {err && <p className="text-sm text-rose">{err}</p>}
              <div className="flex justify-between text-sm">
                <button type="button" className="font-bold underline underline-offset-4" onClick={() => send()} disabled={busy}>Send a new email</button>
                <button type="button" className="text-muted" onClick={() => { setSent(false); setCode(""); setErr(null); }}>Change email</button>
              </div>
            </form>
          ) : (
            <form onSubmit={send} className="space-y-4">
              <div>
                <p className="display text-3xl mb-1">Sign in</p>
                <p className="text-sm text-muted">No password. We’ll email you a link and a code.</p>
              </div>
              <input className="input" type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              <button className="btn-primary w-full" disabled={busy}>{busy ? "Sending…" : "Email me a sign-in link"}</button>
              {err && <p className="text-sm text-rose">{err}</p>}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Login() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
