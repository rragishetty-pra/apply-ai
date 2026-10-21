"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Supabase sends people back with "#error_code=otp_expired" when a sign-in link is stale
 * (already used, replaced by a newer email, or opened by an email security scanner).
 * Catch that on any page and take them to sign-in with a clear message.
 */
export default function AuthLinkErrors() {
  const router = useRouter();
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("error=") || hash.includes("error_code=")) {
      history.replaceState(null, "", window.location.pathname);
      router.replace("/login?expired=1");
    }
  }, [router]);
  return null;
}
