import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { briefItems, recentUserText, writeBrief } from "@/lib/channels/brief";
import { accessTokenFor } from "@/lib/channels/links";
import { sendMessage } from "@/lib/channels/telegram";
import { scheduledFor, type Scheduled } from "@/lib/bank/accountant/closing";
import { runScheduled } from "@/lib/bank/accountant/schedule";
import { sessionFor, today } from "@/lib/mcp/session";
import { adminClient } from "@/lib/supabase/admin";

// Vercel Cron (vercel.json), once a day: Sply Accountant when the day calls for it (weekly review on Mondays, closing
// of last month on the 10th, reminder on the 15th: lib/bank/accountant/closing), then the morning brief for every
// linked chat that wants it. Vercel calls with "Authorization: Bearer $CRON_SECRET".
// ?accountant=weekly|closing&org=<id> runs that one now for one organization's admins, and sends no brief (to try it).
export const maxDuration = 300;

const FORCE: Record<string, Scheduled> = { weekly: "weekly", closing: "closing" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Claude passes only while the function has time for them (one try each); the messages go out regardless.
const PASS_UNTIL_MS = 150_000;
const PASS_TIMEOUT_MS = 90_000;

/** Whether some time zone's today, around now, is a day Sply Accountant writes (cheap: no session needed). */
function maybeScheduled(now: number) {
  return [-1, 0, 1].some((d) => scheduledFor(new Date(now + d * 86_400_000).toISOString().slice(0, 10)) !== null);
}

export async function GET(request: NextRequest) {
  if (!authorized(request.headers.get("authorization"))) return new NextResponse(null, { status: 401 });
  const started = Date.now();
  const params = request.nextUrl.searchParams;
  const force = FORCE[params.get("accountant") ?? ""] ?? null;
  const forceOrg = params.get("org");
  if (params.has("accountant") && (!force || !forceOrg || !UUID.test(forceOrg))) {
    return NextResponse.json({ error: "accountant=weekly|closing needs org=<organization id>" }, { status: 400 });
  }
  const db = adminClient();
  const { data: links } = await db.from("channel_links").select("id, user_id, external_id, last_user_text, brief_enabled, accountant_sent_on")
    .eq("channel", "telegram").not("external_id", "is", null).order("created_at");
  const booksDay = force !== null || maybeScheduled(started);

  let sent = 0, quiet = 0, failed = 0, books = 0;
  const passed = new Set<string>(); // organizations already gone through today
  for (const link of links ?? []) {
    // A chat without the brief is only woken on a day Sply Accountant may write.
    if (!link.brief_enabled && !booksDay) continue;
    try {
      const token = await accessTokenFor(link.id);
      if (!token) { failed++; continue; } // expired link: the next chat message asks to reconnect
      const session = await sessionFor(token, link.user_id);
      if (force && session.org.id !== forceOrg!.toLowerCase()) continue;
      const day = today(session);

      let booksSent = false;
      const what = force ?? scheduledFor(day);
      if (what && session.role === "admin" && (force || link.accountant_sent_on !== day)) {
        const pass = !passed.has(session.org.id) && Date.now() - started < PASS_UNTIL_MS ? { timeoutMs: PASS_TIMEOUT_MS } : null;
        passed.add(session.org.id);
        booksSent = await runScheduled(session, { id: link.id, chat: link.external_id! }, what, pass)
          .catch((e) => { console.error("[accountant] scheduled", link.id, e); return false; });
        if (booksSent) {
          books++;
          await db.from("channel_links").update({ accountant_sent_on: day }).eq("id", link.id);
        }
      }
      if (force || !link.brief_enabled) continue;

      const items = await briefItems(session, { booksSent });
      if (!items) { quiet++; continue; }
      const { data: convo } = await db.from("chat_conversations").select("messages").eq("link_id", link.id).maybeSingle();
      const said = recentUserText((convo?.messages ?? []) as Anthropic.Beta.Messages.BetaMessageParam[]);
      const text = await writeBrief(items, link.last_user_text ? [link.last_user_text, ...said] : said);
      await sendMessage(link.external_id!, text);
      await db.from("chat_conversations").upsert({ link_id: link.id, brief: text, brief_at: new Date().toISOString() }, { onConflict: "link_id" });
      sent++;
    } catch (e) {
      console.error("[brief]", link.id, e);
      failed++;
    }
  }
  return NextResponse.json({ sent, quiet, failed, books });
}

function authorized(header: string | null) {
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || !header || header.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}
