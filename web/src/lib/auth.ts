import "server-only";
import { createHash, randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "./supabase-admin";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Signed-in web user, from the "Authorization: Bearer <supabase access token>" header. */
export async function requireUser(req: Request): Promise<{ id: string; email: string | null }> {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new HttpError(401, "Please sign in again.");
  const { data, error } = await supabaseAdmin().auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Your session expired. Please sign in again.");
  return { id: data.user.id, email: data.user.email ?? null };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newExtensionToken(): string {
  return "apx_" + randomBytes(32).toString("base64url");
}

/** Chrome extension caller, from the "X-Apply-Token" header. */
export async function requireExtension(req: Request): Promise<{ id: string }> {
  const token = req.headers.get("x-apply-token") || "";
  if (!token) throw new HttpError(401, "Extension is not connected. Open Apply.ai and connect it again.");
  const db = supabaseAdmin();
  const { data } = await db
    .from("extension_tokens")
    .select("id, user_id, revoked")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (!data || data.revoked) throw new HttpError(401, "Extension is not connected. Open Apply.ai and connect it again.");
  await db.from("extension_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return { id: data.user_id };
}

/** Wrap a route handler so thrown HttpErrors become JSON responses. */
export function handle<A extends unknown[]>(fn: (req: Request, ...rest: A) => Promise<Response>) {
  return async (req: Request, ...rest: A): Promise<Response> => {
    try {
      return await fn(req, ...rest);
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status, headers: cors() });
      console.error(e);
      const msg = e instanceof Error ? e.message : "Something went wrong";
      return NextResponse.json({ error: msg }, { status: 500, headers: cors() });
    }
  };
}

/** The extension calls the API from chrome-extension:// origins. */
export function cors(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Apply-Token, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  };
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: cors() });
}

export function preflight() {
  return new Response(null, { status: 204, headers: cors() });
}
