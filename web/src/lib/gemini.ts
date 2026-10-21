import "server-only";
import { HttpError } from "./auth";

/**
 * Minimal Gemini client (REST, JSON mode). One place to swap providers later.
 * Free tier: limits are per Google Cloud project, shared by every Apply.ai user.
 */
export async function askJSON<T>(prompt: string, opts: { temperature?: number; maxTokens?: number } = {}): Promise<T> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new HttpError(500, "GEMINI_API_KEY is not set on the server.");
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
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

  if (res.status === 429) {
    throw new HttpError(429, "The AI's free daily/minute limit was reached. Tailor will continue shortly.");
  }
  if (!res.ok) {
    const body = await res.text();
    throw new HttpError(502, `AI request failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text: string =
    data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") ?? "";
  return parseJSON<T>(text);
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
