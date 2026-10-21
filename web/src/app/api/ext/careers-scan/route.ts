import { handle, json, preflight, requireExtension } from "@/lib/auth";
import { scanChunk } from "@/lib/careers";

export const OPTIONS = preflight;
export const maxDuration = 60;

/** Hunter's daily run calls this repeatedly (cursor → next) to cover the user's company list. */
export const POST = handle(async (req) => {
  const user = await requireExtension(req);
  const body = await req.json().catch(() => ({}));
  const cursor = Math.max(0, Number(body.cursor) || 0);
  return json(await scanChunk(user.id, cursor));
});
