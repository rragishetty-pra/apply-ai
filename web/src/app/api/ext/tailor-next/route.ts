import { handle, json, preflight, requireExtension } from "@/lib/auth";
import { tailorNext } from "@/lib/tailor-run";

export const OPTIONS = preflight;
export const maxDuration = 120; // full tailoring step (Fluid compute)

export const POST = handle(async (req) => {
  const user = await requireExtension(req);
  return json(await tailorNext(user.id));
});
