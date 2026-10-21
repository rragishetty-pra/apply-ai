import { handle, json, requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { capStatus } from "@/lib/networker";

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  const [{ data, error }, cap] = await Promise.all([
    supabaseAdmin().from("contacts").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(500),
    capStatus(user.id),
  ]);
  if (error) throw new Error(error.message);
  return json({ contacts: data || [], ...cap });
});
