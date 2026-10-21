import { handle, json, requireUser } from "@/lib/auth";
import { applierNext } from "@/lib/applier";

export const maxDuration = 60;

/** Dashboard "Prepare apply packs": one job per call; the page loops. */
export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const body = await req.json().catch(() => ({}));
  return json(await applierNext(user.id, typeof body.job_id === "string" ? body.job_id : undefined));
});
