"use client";
import { api } from "@/lib/supabase-browser";

interface Step {
  done: boolean;
  remaining: number;
  step?: "research" | "pack" | "failed";
  rate_limited?: boolean;
  daily_limit?: boolean;
  message?: string;
}

/**
 * Prepare the apply pack for one job. The server works in short steps (company research,
 * then the pack), so we call it until the pack is written or it tells us why it can't.
 * Returns null on success, or a message to show.
 */
export async function prepareApplyPack(jobId: string, onStatus?: (text: string) => void): Promise<string | null> {
  for (let i = 0; i < 4; i++) {
    const r = await api<Step>("/api/applier/next", { method: "POST", body: JSON.stringify({ job_id: jobId }) });
    if (r.rate_limited) return r.message || "Google's AI is busy right now. Try again in a minute.";
    if (r.step === "failed") return r.message || "Couldn't prepare the apply pack.";
    if (r.step === "pack" || r.done) return null;
    if (r.step === "research") onStatus?.("Checked how this company hires. Writing your pack…");
  }
  return "Applier didn't finish. Try again in a minute.";
}
