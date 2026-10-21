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
