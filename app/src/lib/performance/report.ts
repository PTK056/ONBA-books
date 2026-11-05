import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { APP_URL } from "@/lib/app-url";
import { adminChats } from "@/lib/bank/accountant/notify";
import { sendHtml } from "@/lib/channels/telegram";
import { adminClient } from "@/lib/supabase/admin";
import { buildInput, check, Output, show, SYSTEM, type PreviousAction } from "./analyze";
import { addMonths, ENGINE, facts, type Data, type Facts, type Goal, type Place } from "./metrics";
import { reportButtons, reportText, type ReportView } from "./render";

// Sply Performance: the report of a closed month. The figures come from lib/performance/metrics (code); Claude writes
// the diagnosis and at most three actions from them (lib/performance/analyze), checked before they are kept. Runs as
// the admin whose client is given (RLS: reports are admins only); Telegram goes out with the server key.

const MODEL = process.env.PERFORMANCE_MODEL ?? "claude-opus-5-5";
const client = new Anthropic({ maxRetries: 0 });
const PAGE = 1000;
const REFUNDED_SHARE = 0.05; // as Overview: a stay that kept under 5% of its gross sold no night

export const performanceLink = (month?: string) => `${APP_URL}/performance${month ? `?month=${month.slice(0, 7)}` : ""}`;

/** Every row of a query, page by page (the API returns 1000 at most). */
async function all<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

interface Org { id: string; name: string; reportingCurrency: string; timezone: string }

export async function loadOrg(db: SupabaseClient, orgId: string): Promise<Org> {
  const { data, error } = await db.from("organizations").select("id, name, reporting_currency, timezone").eq("id", orgId).single();
  if (error || !data) throw new Error("organization not found");
  return { id: data.id, name: data.name, reportingCurrency: data.reporting_currency, timezone: data.timezone };
}

export const todayIn = (timezone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

type TxRow = { date: string; villa_id: string; direction: "in" | "out"; source: string; amount_reporting: number; category: { name: string } | null; stay: { platform: string } | null };
type StayDb = { id: string; villa_id: string; check_in: string; check_out: string; platform: string; gross_amount: number; net_amount: number };

/** Everything the figures are made from, for one organization. */
export async function loadData(db: SupabaseClient, orgId: string): Promise<Data> {
  const [{ data: villas }, entries, stays, { data: mails }, { data: blocks }, { data: goals }] = await Promise.all([
    db.from("villas").select("id, name, kind").eq("organization_id", orgId).is("archived_at", null).order("name"),
    all<TxRow>((a, b) => db.from("transactions")
      .select("date, villa_id, direction, source, amount_reporting, category:categories (name), stay:stays (platform)")
      .eq("organization_id", orgId).eq("status", "validated").order("date").order("id").range(a, b) as never),
    all<StayDb>((a, b) => db.from("stays").select("id, villa_id, check_in, check_out, platform, gross_amount, net_amount")
      .eq("organization_id", orgId).neq("status", "canceled").order("check_in").order("id").range(a, b) as never),
    // When a booking was made: the platform's confirmation e-mail (admins read them).
    db.from("inbound_emails").select("stay_id, received_at").eq("organization_id", orgId).eq("kind", "confirmed").not("stay_id", "is", null).limit(5000),
    db.from("villa_blocks").select("villa_id, starts_on, ends_on, reason").eq("organization_id", orgId).limit(5000),
    db.from("performance_goals").select("id, label, villa_id, since, by_date, target, invested, planned, planned_note")
      .eq("organization_id", orgId).is("archived_at", null).order("created_at"),
  ]);
  const bookedOn = new Map<string, string>();
  for (const m of mails ?? []) {
    const d = (m.received_at as string | null)?.slice(0, 10);
    if (d && (!bookedOn.has(m.stay_id) || d < bookedOn.get(m.stay_id)!)) bookedOn.set(m.stay_id, d);
  }
  return {
    places: (villas ?? []).map((v) => ({ id: v.id, name: v.name, kind: v.kind === "company" ? "company" : "villa" }) as Place),
    entries: entries.map((t) => ({
      date: t.date, placeId: t.villa_id, direction: t.direction, amount: Number(t.amount_reporting), source: t.source,
      category: t.category?.name ?? null, platform: t.stay?.platform ?? null,
    })),
    stays: stays.map((s) => ({
      placeId: s.villa_id, checkIn: s.check_in, checkOut: s.check_out, platform: s.platform,
      refunded: Number(s.net_amount) <= REFUNDED_SHARE * Number(s.gross_amount), bookedOn: bookedOn.get(s.id) ?? null,
    })),
    blocks: (blocks ?? []).map((b) => ({ placeId: b.villa_id, start: b.starts_on, end: b.ends_on, reason: b.reason })),
    goals: (goals ?? []).map((g): Goal => ({
      id: g.id, label: g.label, placeId: g.villa_id, since: g.since, byDate: g.by_date, target: Number(g.target),
      invested: g.invested === null ? null : Number(g.invested), planned: Number(g.planned), plannedNote: g.planned_note,
    })),
  };
}

/** Whether every place of the organization (villas and company) is closed for the month. */
export async function monthClosedEverywhere(db: SupabaseClient, orgId: string, month: string): Promise<boolean> {
  const [{ data: places }, { data: closes }] = await Promise.all([
    db.from("villas").select("id").eq("organization_id", orgId).is("archived_at", null),
    db.from("month_closes").select("villa_id, status").eq("organization_id", orgId).eq("month", month),
  ]);
  const closed = new Set((closes ?? []).filter((c) => c.status === "closed").map((c) => c.villa_id as string));
  return !!places?.length && places.every((p) => closed.has(p.id));
}

/** The latest month closed everywhere, before this one; null if none. */
export async function lastClosedMonth(db: SupabaseClient, orgId: string): Promise<string | null> {
  const { data: closes } = await db.from("month_closes").select("month").eq("organization_id", orgId).eq("status", "closed")
    .order("month", { ascending: false }).limit(48);
  for (const m of [...new Set((closes ?? []).map((c) => c.month as string))]) if (await monthClosedEverywhere(db, orgId, m)) return m;
  return null;
}

/** Last month's actions, with the figures they cited then and now. */
async function previousActions(db: SupabaseClient, orgId: string, month: string, now: Facts): Promise<PreviousAction[]> {
  const { data: prev } = await db.from("performance_reports").select("id, facts").eq("organization_id", orgId)
    .eq("month", addMonths(month, -1)).eq("status", "ready").maybeSingle();
  if (!prev) return [];
  const before = prev.facts as Facts;
  const { data: actions } = await db.from("performance_actions").select("title, status, metrics, task:tasks (done_at)")
    .eq("report_id", prev.id).order("position");
  return (actions ?? []).map((a) => ({
    title: a.title,
    status: a.status,
    done: !!(a.task as unknown as { done_at: string | null } | null)?.done_at,
    metrics: (a.metrics as string[]).flatMap((k) => {
      const b = before.metrics?.[k], n = now.metrics[k];
      return b || n ? [{ key: k, label: (n ?? b)!.label, before: b ? show(b, before.currency) : "—", now: n ? show(n, now.currency) : "—" }] : [];
    }),
  }));
}

export type Generated = { status: "ready" | "failed" | "busy"; reportId: string | null; error: string | null };

/**
 * Writes the report of a closed month (again, if it exists: its open actions are replaced, those decided are kept).
 * One writer at a time per month; "busy" when another is writing it.
 */
export async function generateReport(db: SupabaseClient, orgId: string, month: string, opts: { timeoutMs?: number } = {}): Promise<Generated> {
  if (!(await monthClosedEverywhere(db, orgId, month))) return { status: "failed", reportId: null, error: "Close the month everywhere first: a report is about final figures." };
  const { data: reportId, error: claimError } = await db.rpc("performance_report_claim", { p_org: orgId, p_month: month });
  if (claimError) throw new Error(`performance_report_claim: ${claimError.message}`);
  if (!reportId) return { status: "busy", reportId: null, error: "The report of this month is being written." };
  // The claim's time is the writer's token: a writer taken over (10 minutes) writes nothing more.
  const { data: claimed } = await db.from("performance_reports").select("updated_at").eq("id", reportId).single();
  const lock = { id: reportId as string, at: claimed?.updated_at as string };

  let f: Facts | null = null;
  try {
    const org = await loadOrg(db, orgId);
    const data = await loadData(db, orgId);
    f = facts(data, month, todayIn(org.timezone), org.reportingCurrency);
    const previous = await previousActions(db, orgId, month, f);

    const { data: granted } = await db.rpc("ai_take", { org: orgId, k: "performance", wanted: 1 });
    if (!granted) return await fail(db, lock, f, "This month's Sply Performance allowance is used up; it renews on the 1st.");

    const villas = data.places.filter((p) => p.kind === "villa");
    const r = await client.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      output_config: { effort: "high", format: betaZodOutputFormat(Output) },
      messages: [{ role: "user", content: JSON.stringify(buildInput(f, { name: org.name, villas: villas.map((v) => v.name) }, previous)) }],
    }, { timeout: opts.timeoutMs ?? 200_000 }).finalMessage();
    const usage = { input_tokens: r.usage.input_tokens, output_tokens: r.usage.output_tokens };
    if (r.stop_reason !== "end_turn") return await fail(db, lock, f, "Sply Performance could not finish its analysis this time.", `stopped: ${r.stop_reason}`, usage);
    const text = r.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const parsed = Output.safeParse(JSON.parse(text));
    if (!parsed.success) return await fail(db, lock, f, "Sply Performance could not finish its analysis this time.", parsed.error.message.slice(0, 300), usage);
    const checked = check(parsed.data, f, villas);
    if (checked.dropped.length) console.warn("[performance] dropped:", checked.dropped);

    const { data: saved, error } = await db.from("performance_reports").update({
      status: "ready", facts: f, analysis: checked.analysis, engine: ENGINE, model: r.model, error: null,
      input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, updated_at: new Date().toISOString(),
    }).eq("id", lock.id).eq("status", "running").eq("updated_at", lock.at).select("id");
    if (error) throw new Error(`performance_reports: ${error.message}`);
    if (!saved?.length) return { status: "busy", reportId: lock.id, error: "Another writer took this report over." };
    // A rewrite replaces the open actions; those decided stay, and the new ones are numbered after them.
    await db.from("performance_actions").delete().eq("report_id", lock.id).eq("status", "proposed");
    const { data: kept } = await db.from("performance_actions").select("position").eq("report_id", lock.id);
    const after = Math.max(0, ...(kept ?? []).map((k) => k.position as number));
    if (checked.actions.length && after + checked.actions.length <= 30) {
      const { error: e } = await db.from("performance_actions").insert(checked.actions.map((a) => ({
        organization_id: orgId, report_id: lock.id, position: after + a.position, villa_id: a.villaId, title: a.title, why: a.why,
        metrics: a.metrics, impact: a.impact, impact_note: a.impactNote, effort: a.effort, due_on: a.dueOn,
      })));
      if (e) throw new Error(`performance_actions: ${e.message}`);
    }
    return { status: "ready", reportId, error: null };
  } catch (e) {
    console.error("[performance]", orgId, month, e);
    return await fail(db, lock, f, "Sply Performance could not write the report this time. Try again in a few minutes.", String(e).slice(0, 300));
  }
}

async function fail(db: SupabaseClient, lock: { id: string; at: string }, f: Facts | null, message: string, detail?: string, usage?: { input_tokens: number; output_tokens: number }): Promise<Generated> {
  const reportId = lock.id;
  if (detail) console.error("[performance]", detail);
  await db.from("performance_reports").update({
    status: "failed", error: message, updated_at: new Date().toISOString(),
    ...(f ? { facts: f, engine: ENGINE } : {}),
    ...(usage ? { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens } : {}),
  }).eq("id", reportId).eq("status", "running").eq("updated_at", lock.at);
  return { status: "failed", reportId, error: message };
}

/** A report as the app and Telegram show it. */
export async function reportView(db: SupabaseClient, orgId: string, reportId: string): Promise<ReportView | null> {
  const { data: r } = await db.from("performance_reports").select("id, month, status, facts, analysis")
    .eq("organization_id", orgId).eq("id", reportId).maybeSingle();
  if (!r || r.status === "running" || !(r.facts as Facts)?.metrics) return null;
  const [{ data: actions }, { data: prev }] = await Promise.all([
    db.from("performance_actions").select("id, position, title, why, impact, impact_note, effort, due_on, status").eq("report_id", r.id).order("position"),
    db.from("performance_reports").select("id").eq("organization_id", orgId).eq("month", addMonths(r.month, -1)).eq("status", "ready").maybeSingle(),
  ]);
  let last: ReportView["last"] = null;
  if (prev) {
    const { data: pa } = await db.from("performance_actions").select("task:tasks (done_at)").eq("report_id", prev.id);
    if (pa?.length) last = { total: pa.length, done: pa.filter((a) => (a.task as unknown as { done_at: string | null } | null)?.done_at).length };
  }
  return {
    month: r.month, facts: r.facts as Facts, analysis: r.analysis as ReportView["analysis"], last,
    actions: (actions ?? []).map((a) => ({
      id: a.id, position: a.position, title: a.title, why: a.why, impact: a.impact === null ? null : Number(a.impact),
      impactNote: a.impact_note, effort: a.effort, dueOn: a.due_on, status: a.status,
    })),
  };
}

/** Sends a report to the organization's admins on Telegram (or to one chat). Returns how many chats got it. */
export async function notifyReport(orgId: string, reportId: string, only?: string): Promise<number> {
  const chats = (await adminChats(orgId)).filter((c) => !only || c.chat === only);
  if (!chats.length) return 0;
  const view = await reportView(adminClient(), orgId, reportId);
  if (!view) return 0;
  const link = performanceLink(view.month);
  let sent = 0;
  for (const c of chats) {
    await sendHtml(c.chat, reportText(view, link), reportButtons(view, link))
      .then(() => sent++).catch((e) => console.error("[performance] telegram", c.chat, e));
  }
  return sent;
}

/**
 * After a month is closed somewhere: once it is closed everywhere, the report is written and sent. Called in the
 * background (after()) by whoever closed it, as that admin.
 */
export async function onMonthClosed(db: SupabaseClient, orgId: string, month: string): Promise<void> {
  if (!(await monthClosedEverywhere(db, orgId, month))) return;
  // Written once on its own; a month reopened and closed again is rewritten on demand (app, /performance), not each time.
  const { data: existing } = await db.from("performance_reports").select("status").eq("organization_id", orgId).eq("month", month).maybeSingle();
  if (existing && existing.status !== "failed") return;
  const g = await generateReport(db, orgId, month);
  if (g.reportId && g.status !== "busy") await notifyReport(orgId, g.reportId);
}
