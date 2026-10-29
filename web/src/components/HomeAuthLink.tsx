"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

/** Home page header: "Sign in" for visitors, "Dashboard" for people who are already signed in. */
export default function HomeAuthLink() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    const sb = supabaseBrowser();
    sb.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setSignedIn(!!s));
    return () => sub.subscription.unsubscribe();
  }, []);
  return signedIn ? (
    <Link href="/dashboard" className="btn-primary">Dashboard</Link>
  ) : (
    <Link href="/login" className="btn-ghost">Sign in</Link>
  );
}
