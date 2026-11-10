import { handle, json, requireUser } from "@/lib/auth";
import { FALLBACK_MODELS, LITE_MODELS, aiProvider } from "@/lib/gemini";

export const maxDuration = 60;

/**
 * AI health check: one tiny request to each Gemini model the app can use (plus one with Google
 * Search), so we can see which models this key can use right now and what Google says if not.
 * Costs a handful of very small requests.
 */
export const GET = handle(async (req) => {
  await requireUser(req);
  if (aiProvider() === "claude") return json(await claudeHealth());
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

/** One tiny request to each Claude model the app uses, plus one with web search. */
async function claudeHealth() {
  const key = process.env.ANTHROPIC_API_KEY!;
  const main = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
  const lite = process.env.CLAUDE_LITE_MODEL || "claude-haiku-5-5";
  const probe = async (model: string, search: boolean) => {
    const t0 = Date.now();
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: AbortSignal.timeout(45_000),
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model,
          max_tokens: 200,
          messages: [{ role: "user", content: search ? "Search the web: name one IT company headquartered in Hyderabad. One line." : "Reply with the word OK." }],
          ...(search ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1 }] } : {}),
        }),
      });
      const body = await res.text();
      const searched = search && /web_search_tool_result/.test(body);
      return {
        model: model + (search ? " + web search" : ""),
        status: res.status,
        ms: Date.now() - t0,
        ok: res.ok && (!search || searched),
        ...(res.ok ? (search && !searched ? { message: "answered without searching" } : {}) : { message: (body.match(/"message"\s*:\s*"([^"]+)/) || [])[1]?.slice(0, 200) }),
      };
    } catch (e) {
      return { model, status: 0, ms: Date.now() - t0, ok: false, message: (e as Error).name === "TimeoutError" ? "no answer within 45s" : (e as Error).message };
    }
  };
  const results = await Promise.all([probe(main, false), probe(lite, false), probe(main, true)]);
  return { provider: "claude", configured: { CLAUDE_MODEL: main, CLAUDE_LITE_MODEL: lite }, results };
}
