import "server-only";
import { HttpError } from "./auth";

/**
 * Claude (Anthropic Messages API) client for Apply.ai's agents.
 * Same contract as the Gemini client: askJSON for a JSON answer, askGroundedJSON for a JSON answer
 * that may use web search. Selected in gemini.ts when ANTHROPIC_API_KEY is set.
 *
 *   ANTHROPIC_API_KEY   required
 *   CLAUDE_MODEL        main model (Tailor, Applier, Coach, Achievements) — default claude-sonnet-5-5
 *   CLAUDE_LITE_MODEL   cheap first passes (quick scores, title triage)   — default claude-haiku-5-5
 */

/** A problem with the AI service, not with a job. `daily` = stop for now (e.g. out of credit). */
export class ClaudeError extends HttpError {
  constructor(status: number, message: string, public daily = false) {
    super(status, message);
  }
}

export type ClaudePart = { text: string } | { inline_data: { mime_type: string; data: string } };

const API = "https://api.anthropic.com/v1/messages";
const MAIN = () => process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
const LITE = () => process.env.CLAUDE_LITE_MODEL || "claude-haiku-5-5";
const SYSTEM =
  "You are an agent inside Apply.ai, a job-search assistant. Reply with ONLY one valid JSON object (or array if asked) — " +
  "no prose before or after it, no markdown code fences.";

// Some newer models don't accept a temperature setting; if the API says so we stop sending it.
const noTemperature = new Set<string>();

type Block =
  | { type: "text"; text: string; citations?: { url?: string; title?: string }[] }
  | { type: "web_search_tool_result"; content: { type: string; url?: string; title?: string }[] | { type: string; error_code?: string } }
  | { type: string; [k: string]: unknown };

function toContent(prompt: string | ClaudePart[]) {
  if (typeof prompt === "string") return [{ type: "text", text: prompt }];
  return prompt.map((p) =>
    "text" in p
      ? { type: "text", text: p.text }
      : { type: "image", source: { type: "base64", media_type: p.inline_data.mime_type, data: p.inline_data.data } }
  );
}

async function call(body: Record<string, unknown>, timeoutMs: number): Promise<{ content: Block[]; stop_reason: string }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new ClaudeError(500, "ANTHROPIC_API_KEY is not set on the server.");
  const model = String(body.model);
  const send = (b: Record<string, unknown>) =>
    fetch(API, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(b),
    });

  let res: Response;
  try {
    if (noTemperature.has(model)) delete body.temperature;
    res = await send(body);
    if (res.status === 400 && body.temperature !== undefined) {
      const text = await res.clone().text();
      if (/temperature/i.test(text)) {
        noTemperature.add(model);
        delete body.temperature;
        res = await send(body);
      }
    }
  } catch (e) {
    const name = (e as Error)?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new ClaudeError(504, "The AI took too long to answer. It will be retried on the next pass.");
    }
    throw new ClaudeError(502, `Couldn't reach Claude (${(e as Error)?.message || e}).`);
  }

  if (res.ok) return res.json();

  const text = await res.text().catch(() => "");
  const msg = (text.match(/"message"\s*:\s*"([^"]+)/) || [])[1] || text.slice(0, 200);
  if (res.status === 401 || res.status === 403)
    throw new ClaudeError(500, "The Anthropic API key on the server isn't valid. Check ANTHROPIC_API_KEY in Vercel.", true);
  if (res.status === 400 && /credit balance|billing/i.test(msg))
    throw new ClaudeError(402, "Your Anthropic account is out of API credit. Add credit at console.anthropic.com, then carry on.", true);
  if (res.status === 429) {
    const wait = Number(res.headers.get("retry-after")) || 60;
    throw new ClaudeError(429, `Claude's rate limit was reached. Waiting about ${Math.ceil(wait / 60)} minute${wait > 60 ? "s" : ""}, then carrying on.`);
  }
  if (res.status === 529 || res.status === 503 || res.status === 500)
    throw new ClaudeError(503, "Claude is very busy right now. Waiting a minute, then carrying on.");
  if (res.status === 404) throw new ClaudeError(404, `Model ${model} isn't available on this API key (${msg}).`);
  throw new ClaudeError(502, `Claude had a problem (${res.status}): ${msg}`);
}

/** Try the chosen model; if it doesn't exist on this key, fall back to the main model. */
async function callWithFallback(models: string[], body: Record<string, unknown>, timeoutMs: number) {
  const list = [...new Set(models.filter(Boolean))];
  let last: unknown;
  for (const model of list) {
    try {
      return await call({ ...body, model }, timeoutMs);
    } catch (e) {
      last = e;
      if (e instanceof ClaudeError && e.status === 404) continue;
      throw e;
    }
  }
  throw last;
}

function textOf(blocks: Block[]): string {
  return blocks.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
}

export async function claudeAskJSON<T>(
  prompt: string | ClaudePart[],
  opts: { temperature?: number; maxTokens?: number; tier?: "lite" | "main"; timeoutMs?: number },
  parse: (text: string) => T
): Promise<T> {
  const models = opts.tier === "lite" ? [LITE(), MAIN()] : [MAIN()];
  const out = await callWithFallback(
    models,
    {
      max_tokens: opts.maxTokens ?? 8192,
      temperature: opts.temperature ?? 0.3,
      system: SYSTEM,
      messages: [{ role: "user", content: toContent(prompt) }],
    },
    opts.timeoutMs ?? 50_000
  );
  if (out.stop_reason === "max_tokens") throw new ClaudeError(502, "The AI's answer was cut off (too long). Try again.");
  return parse(textOf(out.content));
}

/**
 * JSON answer that may use Claude's web search tool (company hiring practices, interview
 * experiences, careers pages…). Sources come from the search results Claude used.
 */
export async function claudeAskGroundedJSON<T>(
  prompt: string,
  opts: { temperature?: number },
  parse: (text: string) => T
): Promise<{ data: T; sources: { title: string; url: string }[]; searchHtml: null; grounded: boolean }> {
  const deadline = Date.now() + 100_000;
  const messages: { role: string; content: unknown }[] = [
    { role: "user", content: [{ type: "text", text: prompt + "\n\nSearch the web as needed, then reply with ONLY the JSON object." }] },
  ];
  const tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }];
  let blocks: Block[] = [];

  // Long searches can pause mid-turn ("pause_turn"): send the turn back to let Claude finish.
  for (let round = 0; round < 3; round++) {
    const left = deadline - Date.now();
    if (left < 10_000) break;
    const out = await callWithFallback(
      [MAIN()],
      { max_tokens: 8192, temperature: opts.temperature ?? 0.4, system: SYSTEM, tools, messages },
      left
    );
    blocks = [...blocks, ...out.content];
    if (out.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: out.content });
  }

  // Sources: every web result Claude received, cited ones first.
  const cited: { title: string; url: string }[] = [];
  const seen = new Set<string>();
  const add = (url?: string, title?: string) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    let host = url;
    try { host = new URL(url).hostname; } catch {}
    cited.push({ url, title: title || host });
  };
  for (const b of blocks) if (b.type === "text") for (const c of (b as { citations?: { url?: string; title?: string }[] }).citations || []) add(c.url, c.title);
  for (const b of blocks)
    if (b.type === "web_search_tool_result" && Array.isArray((b as { content: unknown }).content))
      for (const r of (b as { content: { url?: string; title?: string }[] }).content) add(r.url, r.title);

  // The answer is the text after the last search result (earlier text is Claude narrating its searches).
  let lastResult = -1;
  blocks.forEach((b, i) => { if (b.type === "web_search_tool_result") lastResult = i; });
  const answer = textOf(blocks.slice(lastResult + 1)) || textOf(blocks);
  return { data: parse(answer), sources: cited.slice(0, 20), searchHtml: null, grounded: cited.length > 0 };
}
