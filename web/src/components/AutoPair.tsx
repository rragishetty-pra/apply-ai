"use client";
import { useEffect } from "react";
import { api } from "@/lib/supabase-browser";
import { ask } from "@/components/ExtensionConnect";

/**
 * Keeps the Chrome extension connected. Reloading or re-installing an unpacked extension wipes its
 * storage (and with it the connection), so on every signed-in page we quietly reconnect it if needed.
 */
export default function AutoPair() {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const status = await ask<{ paired: boolean }>("STATUS", {}, 3000).catch(() => null);
      if (cancelled || !status || status.paired) return;
      try {
        const { token } = await api<{ token: string }>("/api/extension/pair", { method: "POST" });
        await ask("PAIR", { token, apiBase: window.location.origin }, 5000);
      } catch {
        /* Settings still offers a manual Connect button */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
