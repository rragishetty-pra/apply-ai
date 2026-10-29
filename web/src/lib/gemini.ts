import "server-only";
import { HttpError } from "./auth";

/**
 * Minimal Gemini client (REST, JSON mode). One place to swap providers later.
 * Free tier: limits are per Google Cloud project, shared by every Apply.ai user.
 *
 * Google retires models over time. If the configured model is gone (404), we try the
 * fallbacks below and remember the first one that works for the life of the server.
 */
/** A problem with the AI service, not with a job. `daily` = the free daily quota is used up. */
export class AIServiceError extends HttpError {
  constructor(status: number, message: string, public daily = false) {
    super(status, message);
  }
}

/** When Google's free daily quota resets (midnight US Pacific), in India time. */
export function quotaResetIST(): string {
  const now = new Date();
  const la = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const offsetMs = now.getTime() - la.getTime(); // UTC - LA wall clock
  const nextMidnightLA = new Date(la);
  nextMidnightLA.setHours(24, 0, 0, 0);
  const reset = new Date(nextMidnightLA.getTime() + offsetMs);
  return reset.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
}

/**
 * Each Gemini model has its own free quota; work out which kind of limit we hit from Google's reply.
 * "none" = this feature/model has a limit of 0 on this key (not part of the free tier at all).
 */
let lastQuotaDetail = "";
async function limitKind(res: Response): Promise<"daily" | "minute" | "none"> {
  const body = await res.text().catch(() => "");
  const ids = [...body.matchAll(/"quotaId"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
  const vals = [...body.matchAll(/"quotaValue"\s*:\s*"?(\d+)/g)].map((m) => Number(m[1]));
  lastQuotaDetail = (ids.join(", ") + (vals.length ? ` (limit ${vals.join(", ")})` : "")).slice(0, 200) || body.slice(0, 200);
  if (vals.length && vals.every((v) => v === 0)) return "none";
  if (/limit:\s*0\b/.test(body)) return "none";
  return /per.?day|PerDay|daily/i.test(body + ids.join(" ")) ? "daily" : "minute";
}

function limitError(kind: "daily" | "minute" | "none" | null): AIServiceError {
  if (kind === "none")
    return new AIServiceError(403, `This AI feature isn't included in Google's free plan for this key (${lastQuotaDetail}).`);
  return kind === "daily"
    ? new AIServiceError(429, `Google's free daily AI limit is used up. It resets at ${quotaResetIST()} (India time); Apply.ai carries on then.`, true)
    : new AIServiceError(429, `Google's free per-minute AI limit was reached. Waiting a minute, then carrying on. [${lastQuotaDetail}]`);
}

// 3.5-flash first: on our key 3.8-flash sometimes doesn't answer at all (seen 29 Oct 2026).
export const FALLBACK_MODELS = ["gemini-3.5-flash", "gemini-3.8-flash", "gemini-2.5-flash"];
// Cheaper, faster model for first-pass scoring. Falls back to the main model if none is available.
export const LITE_MODELS = ["gemini-3.5-flash-lite", "gemini-2.5-flash-lite"];
let workingModel: string | null = null;
let workingLite: string | null = null;

/**
 * fetch with a time cap. Our API routes may run for 60s at most; giving up at 50s means the job
 * goes back in the queue with a clear message instead of the server cutting the request off.
 */
async function timedFetch(url: string, init: RequestInit, ms = 50_000): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
  } catch (e) {
    const name = (e as Error)?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new AIServiceError(504, "The AI took too long to answer. It will be retried on the next pass.");
    }
    throw new AIServiceError(502, `Couldn't reach the AI service (${(e as Error)?.message || e}).`);
  }
}

/** Models that recently didn't answer in time are tried last for 10 minutes. */
const slowUntil = new Map<string, number>();
const SLOW_MS = 10 * 60_000;
function bySpeed(models: string[]): string[] {
  const now = Date.now();
  return [...models.filter((m) => (slowUntil.get(m) || 0) < now), ...models.filter((m) => (slowUntil.get(m) || 0) >= now)];
}

/** A text or image part for multimodal requests. */
export type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

export async function askJSON<T>(
  prompt: string | Part[],
  opts: { temperature?: number; maxTokens?: number; tier?: "lite" | "main"; timeoutMs?: number } = {}
): Promise<T> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AIServiceError(500, "GEMINI_API_KEY is not set on the server.");

  const lite = opts.tier === "lite";
  const main = [workingModel, process.env.GEMINI_MODEL, ...FALLBACK_MODELS];
  const candidates = [
    ...new Set((lite ? [workingLite, process.env.GEMINI_LITE_MODEL, ...LITE_MODELS, ...main] : main).filter(Boolean) as string[]),
  ];
  let lastError = "";
  let busy = false;
  let limited: "daily" | "minute" | "none" | null = null;

  const deadline = Date.now() + (opts.timeoutMs ?? 50_000);
  let timedOut = false;
  for (const model of bySpeed(candidates)) {
    const left = deadline - Date.now();
    if (left < 5_000) break;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    let res: Response;
    try {
      res = await timedFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: typeof prompt === "string" ? [{ text: prompt }] : prompt }],
        generationConfig: {
          temperature: opts.temperature ?? 0.3,
          maxOutputTokens: opts.maxTokens ?? 8192,
          responseMimeType: "application/json",
        },
      }),
    }, left);
    } catch (e) {
      if (e instanceof AIServiceError && e.status === 504) {
        // No answer in time: remember, and let the next model try with the time that's left.
        slowUntil.set(model, Date.now() + SLOW_MS);
        if (workingModel === model) workingModel = null;
        if (workingLite === model) workingLite = null;
        timedOut = true;
        lastError = `model ${model} didn't answer in time`;
        continue;
      }
      throw e;
    }

    if (res.status === 404) {
      // Model retired or unknown → try the next one
      lastError = `model ${model} is not available`;
      if (workingModel === model) workingModel = null;
      if (workingLite === model) workingLite = null;
      continue;
    }
    if (res.status === 429) {
      // This model's free quota is used up: the next model has its own quota.
      const kind = await limitKind(res);
      // Report the most hopeful reason: a per-minute limit clears soonest; "none" only if nothing else.
      if (kind === "minute" || !limited || limited === "none") limited = kind === "none" && limited ? limited : kind;
      lastError = `model ${model} hit its ${kind} limit`;
      continue;
    }
    if (res.status === 503 || res.status === 500) {
      // Google says this model is overloaded right now: try the next model in the chain.
      lastError = `model ${model} is busy`;
      busy = true;
      continue;
    }
    if (!res.ok) {
      const body = await res.text();
      throw new AIServiceError(502, `The AI service had a problem (${res.status}). Try again in a few minutes. ${body.slice(0, 160)}`);
    }

    if (lite && (LITE_MODELS.includes(model) || model === process.env.GEMINI_LITE_MODEL)) workingLite = model;
    else workingModel = model;
    const data = await res.json();
    const text: string =
      data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") ?? "";
    return parseJSON<T>(text);
  }

  if (limited) throw limitError(limited);
  if (timedOut) throw new AIServiceError(504, "The AI took too long to answer. It will be retried on the next pass.");
  if (busy) throw new AIServiceError(503, "Google's AI is very busy right now. Waiting a minute, then carrying on.");
  throw new AIServiceError(
    503,
    `No AI model is available (${lastError}). Set GEMINI_MODEL in Vercel to a current model, e.g. gemini-3.8-flash.`
  );
}

export interface Grounded<T> {
  data: T;
  sources: { title: string; url: string }[];
  searchHtml: string | null; // Google's search-suggestion chip; must be shown alongside grounded results
  grounded: boolean;
}

/**
 * Ask with Google Search grounding so the model can read current public pages
 * (interview experiences, course pages…). Falls back to an ungrounded answer if
 * search isn't available on this key/model, and says so via `grounded: false`.
 */
export async function askGroundedJSON<T>(prompt: string, opts: { temperature?: number } = {}): Promise<Grounded<T>> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AIServiceError(500, "GEMINI_API_KEY is not set on the server.");
  const candidates = [...new Set([workingModel, process.env.GEMINI_MODEL, ...FALLBACK_MODELS].filter(Boolean) as string[])];
  let gLimited: "daily" | "minute" | "none" | null = null;

  const gDeadline = Date.now() + 50_000;
  for (const model of bySpeed(candidates)) {
    const left = gDeadline - Date.now();
    if (left < 5_000) break;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    let res: Response;
    try {
      res = await timedFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt + "\n\nReply with ONLY the JSON object, no other text." }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: opts.temperature ?? 0.4, maxOutputTokens: 8192 },
      }),
    }, left);
    } catch (e) {
      if (e instanceof AIServiceError && e.status === 504) {
        slowUntil.set(model, Date.now() + SLOW_MS);
        if (workingModel === model) workingModel = null;
        continue;
      }
      throw e;
    }
    if (res.status === 404) {
      if (workingModel === model) workingModel = null;
      continue;
    }
    if (res.status === 429) {
      const kind = await limitKind(res);
      if (kind === "minute" || !gLimited || gLimited === "none") gLimited = kind === "none" && gLimited ? gLimited : kind;
      continue;
    }
    if (res.status === 503 || res.status === 500) continue; // overloaded: try the next model
    if (res.status === 400 || res.status === 403) {
      // Search grounding not available for this key/model → ungrounded answer
      const data = await askJSON<T>(prompt, opts);
      return { data, sources: [], searchHtml: null, grounded: false };
    }
    if (!res.ok) {
      const body = await res.text();
      throw new AIServiceError(502, `The AI service had a problem (${res.status}). Try again in a few minutes. ${body.slice(0, 160)}`);
    }
    workingModel = model;
    const json = await res.json();
    const cand = json?.candidates?.[0];
    const text: string = cand?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") ?? "";
    const meta = cand?.groundingMetadata || {};
    const seen = new Set<string>();
    const sources: { title: string; url: string }[] = [];
    for (const c of meta.groundingChunks || []) {
      const u = c?.web?.uri;
      if (u && !seen.has(u)) {
        seen.add(u);
        sources.push({ title: c.web.title || new URL(u).hostname, url: u });
      }
    }
    return {
      data: parseJSON<T>(text),
      sources: sources.slice(0, 20),
      searchHtml: meta.searchEntryPoint?.renderedContent || null,
      grounded: sources.length > 0,
    };
  }
  if (gLimited) {
    // Google Search refused (on our free key its search quota is used up or zero, while plain answers
    // still work): answer without search, and say so via grounded: false.
    const data = await askJSON<T>(prompt, opts);
    return { data, sources: [], searchHtml: null, grounded: false };
  }
  throw new AIServiceError(503, "No AI model is available. Set GEMINI_MODEL in Vercel to a current model, e.g. gemini-3.8-flash.");
}

export function parseJSON<T>(text: string): T {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.search(/[[{]/);
    const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)) as T;
    throw new HttpError(502, "AI returned an unreadable answer. Try again.");
  }
}
