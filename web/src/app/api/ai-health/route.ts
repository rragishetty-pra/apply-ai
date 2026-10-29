import { handle, json, requireUser } from "@/lib/auth";
import { FALLBACK_MODELS, LITE_MODELS } from "@/lib/gemini";

export const maxDuration = 60;

/**
 * AI health check: one tiny request to each Gemini model the app can use (plus one with Google
 * Search), so we can see which models this key can use right now and what Google says if not.
 * Costs a handful of very small requests.
 */
export const GET = handle(async (req) => {
  await requireUser(req);
  const key = process.env.GEMINI_API_KEY;
  if (!key) return json({ error: "GEMINI_API_KEY is not set" });
  const models = [...new Set([process.env.GEMINI_MODEL, process.env.GEMINI_LITE_MODEL, ...FALLBACK_MODELS, ...LITE_MODELS].filter(Boolean) as string[])];

  const probe = async (model: string, search: boolean) => {
    const t0 = Date.now();
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        signal: AbortSignal.timeout(25_000),
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: search ? "Using Google Search, name one company headquartered in Hyderabad. One line." : "Reply with the word OK." }] }],
          ...(search ? { tools: [{ google_search: {} }] } : {}),
          generationConfig: { maxOutputTokens: 64 },
        }),
      });
      const body = await res.text();
      const quota = [...body.matchAll(/"quotaId"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
      const limits = [...body.matchAll(/"quotaValue"\s*:\s*"?(\d+)/g)].map((m) => m[1]);
      return {
        model: model + (search ? " + Google Search" : ""),
        status: res.status,
        ms: Date.now() - t0,
        ok: res.ok,
        ...(res.ok ? {} : { message: (body.match(/"message"\s*:\s*"([^"]+)/) || [])[1]?.slice(0, 200), quota, limits }),
      };
    } catch (e) {
      return { model: model + (search ? " + Google Search" : ""), status: 0, ms: Date.now() - t0, ok: false, message: (e as Error).name === "TimeoutError" ? "no answer within 25s" : (e as Error).message };
    }
  };

  const results = await Promise.all([...models.map((m) => probe(m, false)), ...FALLBACK_MODELS.map((m) => probe(m, true))]);
  return json({ configured: { GEMINI_MODEL: process.env.GEMINI_MODEL || null, GEMINI_LITE_MODEL: process.env.GEMINI_LITE_MODEL || null }, results });
});
