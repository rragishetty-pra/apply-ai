import { NextResponse } from "next/server";
import { getTodayStats } from "@/lib/stats";

export const revalidate = 300; // refresh at most every 5 minutes

/** Public, aggregate-only numbers for "Today on Apply.ai". */
export async function GET() {
  return NextResponse.json(await getTodayStats());
}
