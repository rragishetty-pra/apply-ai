import { handle, HttpError, json, preflight, requireExtension } from "@/lib/auth";
import { draftForJob } from "@/lib/networker";

export const OPTIONS = preflight;
export const maxDuration = 60;

/** People the extension found on LinkedIn for one job → Networker picks and drafts referral asks. */
export const POST = handle(async (req) => {
  const user = await requireExtension(req);
  const body = await req.json();
  if (!body.job_id) throw new HttpError(400, "Missing job");
  const people = Array.isArray(body.people) ? body.people.slice(0, 80) : [];
  return json(await draftForJob(user.id, String(body.job_id), people));
});
