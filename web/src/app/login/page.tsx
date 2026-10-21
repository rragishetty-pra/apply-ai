"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { Logo } from "@/components/Shell";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabaseBrowser();
    sb.auth.getSession().then(({ data }) => data.session && router.replace("/dashboard"));
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => s && router.replace("/dashboard"));
    return () => sub.subscription.unsubscribe();
  }, [router]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/dashboard` },
    });
    setBusy(false);
    if (error) setErr(error.message);
    else setSent(true);
  }

  return (
    <div className="min-h-screen grid place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8"><Logo /></div>
        <div className="card p-7">
          {sent ? (
            <div className="text-center">
              <p className="serif text-3xl mb-2">Check your email</p>
              <p className="text-sm text-muted">We sent a sign-in link to <b>{email}</b>. Open it on this device.</p>
              <button className="btn-ghost mt-6 w-full" onClick={() => setSent(false)}>Use a different email</button>
            </div>
          ) : (
            <form onSubmit={send} className="space-y-4">
              <div>
                <p className="serif text-3xl mb-1">Sign in</p>
                <p className="text-sm text-muted">No password — we’ll email you a link.</p>
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
