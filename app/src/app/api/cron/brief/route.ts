import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { briefItems, recentUserText, writeBrief } from "@/lib/channels/brief";
import { accessTokenFor } from "@/lib/channels/links";
import { sendMessage } from "@/lib/channels/telegram";
import { sessionFor } from "@/lib/mcp/session";
import { adminClient } from "@/lib/supabase/admin";

// Vercel Cron (vercel.json), once a day: the morning brief for every linked chat that wants it.
// Vercel calls with "Authorization: Bearer $CRON_SECRET".
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!authorized(request.headers.get("authorization"))) return new NextResponse(null, { status: 401 });
  const db = adminClient();
  const { data: links } = await db.from("channel_links").select("id, user_id, external_id")
    .eq("channel", "telegram").eq("brief_enabled", true).not("external_id", "is", null);

  let sent = 0, quiet = 0, failed = 0;
  for (const link of links ?? []) {
    try {
      const token = await accessTokenFor(link.id);
      if (!token) { failed++; continue; } // expired link: the next chat message asks to reconnect
      const items = await briefItems(await sessionFor(token, link.user_id));
      if (!items) { quiet++; continue; }
      const { data: convo } = await db.from("chat_conversations").select("messages").eq("link_id", link.id).maybeSingle();
      const text = await writeBrief(items, recentUserText((convo?.messages ?? []) as Anthropic.Beta.Messages.BetaMessageParam[]));
      await sendMessage(link.external_id!, text);
      await db.from("chat_conversations").upsert({ link_id: link.id, brief: text, brief_at: new Date().toISOString() }, { onConflict: "link_id" });
      sent++;
    } catch (e) {
      console.error("[brief]", link.id, e);
      failed++;
    }
  }
  return NextResponse.json({ sent, quiet, failed });
}

function authorized(header: string | null) {
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || !header || header.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}
