import "server-only";
import { HttpError } from "./auth";

/**
 * Minimal Gemini client (REST, JSON mode). One place to swap providers later.
 * Free tier: limits are per Google Cloud project, shared by every Apply.ai user.
 *
 * Google retires models over time. If the configured model is gone (404), we try the
 * fallbacks below and remember the first one that works for the life of the server.
 */
export class AIServiceError extends HttpError {} // a problem with the AI service, not with a job

const FALLBACK_MODELS = ["gemini-3.8-flash", "gemini-3.5-flash", "gemini-2.5-flash"];
// Cheaper, faster model for first-pass scoring. Falls back to the main model if none is available.
const LITE_MODELS = ["gemini-3.5-flash-lite", "gemini-2.5-flash-lite"];
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

  for (const model of candidates) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const res = await timedFetch(url, {
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
    });

    if (res.status === 404) {
      // Model retired or unknown → try the next one
      lastError = `model ${model} is not available`;
      if (workingModel === model) workingModel = null;
      if (workingLite === model) workingLite = null;
      continue;
    }
    if (res.status === 429) {
      throw new AIServiceError(429, "The AI's free daily/minute limit was reached. Tailor will continue shortly.");
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

  for (const model of candidates) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const res = await timedFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt + "\n\nReply with ONLY the JSON object, no other text." }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: opts.temperature ?? 0.4, maxOutputTokens: 8192 },
      }),
    });
    if (res.status === 404) {
      if (workingModel === model) workingModel = null;
      continue;
    }
    if (res.status === 429) throw new AIServiceError(429, "The AI's free limit was reached. Try again in a minute.");
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
