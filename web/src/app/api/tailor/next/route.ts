import { handle, json, requireUser } from "@/lib/auth";
import { tailorNext } from "@/lib/tailor-run";

export const maxDuration = 60;

/** Dashboard "Run Tailor": processes one queued job per call; the page loops until done. */
export const POST = handle(async (req) => {
  const user = await requireUser(req);
  return json(await tailorNext(user.id));
});
