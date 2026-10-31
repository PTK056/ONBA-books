import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { syncOrganization } from "@/lib/mail/sync";
import { adminClient } from "@/lib/supabase/admin";

// Vercel Cron (vercel.json), once a day before the morning brief: Airbnb e-mails of every
// organization with Gmail connected. Vercel calls with "Authorization: Bearer $CRON_SECRET".
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!authorized(request.headers.get("authorization"))) return new NextResponse(null, { status: 401 });
  const db = adminClient();
  const { data: connections } = await db.from("mail_connections").select("organization_id").eq("status", "active");

  let read = 0, booked = 0, failed = 0;
  for (const c of connections ?? []) {
    try {
      const r = await syncOrganization(db, c.organization_id);
      read += r.read;
      booked += r.booked;
    } catch (e) {
      console.error("[mail]", c.organization_id, e);
      failed++;
    }
  }
  return NextResponse.json({ organizations: connections?.length ?? 0, read, booked, failed });
}

function authorized(header: string | null) {
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || !header || header.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}
