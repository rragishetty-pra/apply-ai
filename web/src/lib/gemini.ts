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
let workingModel: string | null = null;

export async function askJSON<T>(prompt: string, opts: { temperature?: number; maxTokens?: number } = {}): Promise<T> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AIServiceError(500, "GEMINI_API_KEY is not set on the server.");

  const candidates = [...new Set([workingModel, process.env.GEMINI_MODEL, ...FALLBACK_MODELS].filter(Boolean) as string[])];
  let lastError = "";

  for (const model of candidates) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
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
      continue;
    }
    if (res.status === 429) {
      throw new AIServiceError(429, "The AI's free daily/minute limit was reached. Tailor will continue shortly.");
    }
    if (!res.ok) {
      const body = await res.text();
      throw new AIServiceError(502, `The AI service had a problem (${res.status}). Try again in a few minutes. ${body.slice(0, 160)}`);
    }

    workingModel = model;
    const data = await res.json();
    const text: string =
      data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") ?? "";
    return parseJSON<T>(text);
  }

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
    const res = await fetch(url, {
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
