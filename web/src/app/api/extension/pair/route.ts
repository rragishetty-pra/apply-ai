import { handle, hashToken, json, newExtensionToken, requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

/** Create a token for the Chrome extension. The plain token is returned once and never stored. */
export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const token = newExtensionToken();
  const { error } = await supabaseAdmin()
    .from("extension_tokens")
    .insert({ user_id: user.id, token_hash: hashToken(token), label: "Chrome" });
  if (error) throw new Error(error.message);
  return json({ token });
});

/** Disconnect every extension for this user. */
export const DELETE = handle(async (req) => {
  const user = await requireUser(req);
  await supabaseAdmin().from("extension_tokens").update({ revoked: true }).eq("user_id", user.id);
  return json({ ok: true });
});

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  const { data } = await supabaseAdmin()
    .from("extension_tokens")
    .select("id, created_at, last_used_at")
    .eq("user_id", user.id)
    .eq("revoked", false)
    .order("created_at", { ascending: false });
  return json({ tokens: data || [] });
});
