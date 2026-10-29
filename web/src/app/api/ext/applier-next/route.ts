import { handle, json, preflight, requireExtension } from "@/lib/auth";
import { applierNext } from "@/lib/applier";

export const OPTIONS = preflight;
export const maxDuration = 180; // writing an apply pack can take 1–2 minutes when Google is busy (Fluid compute)

export const POST = handle(async (req) => {
  const user = await requireExtension(req);
  return json(await applierNext(user.id));
});
