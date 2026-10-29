import { handle, json, requireUser } from "@/lib/auth";
import { applierNext } from "@/lib/applier";

export const maxDuration = 180; // writing an apply pack can take 1–2 minutes when Google is busy (Fluid compute)

/** Dashboard "Prepare apply packs": one job per call; the page loops. */
export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const body = await req.json().catch(() => ({}));
  return json(await applierNext(user.id, typeof body.job_id === "string" ? body.job_id : undefined));
});
