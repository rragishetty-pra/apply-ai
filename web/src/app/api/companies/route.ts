import { handle, HttpError, json, requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ensureSeeded } from "@/lib/careers";
import { INDUSTRIES } from "@/lib/portal-list";

/** Coverage summary for Settings, plus the companies this user added. */
export const GET = handle(async (req) => {
  const user = await requireUser(req);
  await ensureSeeded();
  const db = supabaseAdmin();
  const { data } = await db.from("companies").select("industry, status");
  const byIndustry: Record<string, { total: number; searchable: number }> = {};
  for (const r of data || []) {
    const k = r.industry || "Other";
    byIndustry[k] = byIndustry[k] || { total: 0, searchable: 0 };
    byIndustry[k].total++;
    if (r.status === "resolved") byIndustry[k].searchable++;
  }
  const { data: mine } = await db
    .from("companies")
    .select("id, name, industry, status, error")
    .eq("added_by", user.id)
    .order("created_at", { ascending: false });
  return json({ total: (data || []).length, byIndustry, mine: mine || [] });
});

/** Add a company to the careers-page search (shared with everyone; resolved on the next Hunter run). */
export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const body = await req.json();
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  if (name.length < 2) throw new HttpError(400, "Type the company's name.");
  const industry = (INDUSTRIES as readonly string[]).includes(body.industry) ? body.industry : null;
  const db = supabaseAdmin();
  const { data: existing } = await db.from("companies").select("id, name, status").ilike("name", name.replace(/[%_\\]/g, "")).limit(1).maybeSingle();
  if (existing) return json({ company: existing, existed: true });
  const { data, error } = await db.from("companies").insert({ name, industry, added_by: user.id }).select("id, name, industry, status").single();
  if (error) throw new Error(error.message);
  return json({ company: data, existed: false });
});
