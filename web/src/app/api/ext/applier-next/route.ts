import { handle, json, preflight, requireExtension } from "@/lib/auth";
import { applierNext } from "@/lib/applier";

export const OPTIONS = preflight;
export const maxDuration = 60;

export const POST = handle(async (req) => {
  const user = await requireExtension(req);
  return json(await applierNext(user.id));
});
