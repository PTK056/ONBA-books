import "server-only";
import { z } from "zod";
import { show } from "@/lib/performance/analyze";
import { addMonths, facts, monthOf } from "@/lib/performance/metrics";
import { lastClosedMonth, loadData, performanceLink, reportView } from "@/lib/performance/report";
import { goalLines } from "@/lib/performance/render";
import { requireAdmin, requireEditor, resolveVilla, today, ToolError, type Session } from "./session";
import type { Registrar } from "./tools";

// Sply Performance for the assistant: nights not for sale (the owner's stays, works), and where the business stands.

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const strip = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

export function definePerformance(server: Registrar) {
  server.registerTool("block_nights", {
    title: "Block nights",
    description:
      "Records nights a villa is not for sale: the owner's own stay (reason owner), works (works), or other. Occupancy then leaves them out. "
      + "`until` is the morning it ends, like a check-out: \"we stay 20 to 29 October\" is from 2026-10-20 until 2026-10-29 (9 nights). "
      + "If the user gives the last night instead, until is the day after. Ask if the dates are unclear. Repeat the nights recorded.",
    inputSchema: z.object({
      villa: z.string().optional(),
      from: DATE.describe("First night blocked."),
      until: DATE.describe("The morning it ends (excluded)."),
      reason: z.enum(["owner", "works", "other"]).optional(),
      note: z.string().max(200).optional(),
    }),
  }, (async (s: Session, a: { villa?: string; from: string; until: string; reason?: "owner" | "works" | "other"; note?: string }) => {
    requireEditor(s);
    const villa = resolveVilla(s, a.villa);
    if (s.company && villa.id === s.company.id) throw new ToolError("Nights are blocked on a villa, not on the company.");
    if (a.until <= a.from) throw new ToolError("`until` must be after `from` (it is the morning it ends).");
    const { data, error } = await s.db.from("villa_blocks").insert({
      organization_id: s.org.id, villa_id: villa.id, starts_on: a.from, ends_on: a.until, reason: a.reason ?? "owner", note: a.note?.trim() || null,
    }).select("id").single();
    if (error || !data) throw new ToolError("Could not record these nights (a year at most). Try again.");
    const nights = Math.round((Date.parse(a.until) - Date.parse(a.from)) / 86_400_000);
    return { status: "blocked", block_id: data.id, villa: villa.name, from: a.from, until: a.until, nights, reason: a.reason ?? "owner" };
  }) as never);

  server.registerTool("unblock_nights", {
    title: "Remove blocked nights",
    description: "Removes nights recorded with block_nights (by its block_id), e.g. when the owner's stay is cancelled or was entered wrong.",
    inputSchema: z.object({ block_id: z.string().uuid() }),
    annotations: { destructiveHint: true },
  }, (async (s: Session, a: { block_id: string }) => {
    requireEditor(s);
    const { data, error } = await s.db.from("villa_blocks").delete().eq("id", a.block_id).eq("organization_id", s.org.id).select("starts_on, ends_on");
    if (error) throw new ToolError("Could not remove them. Try again.");
    if (!data?.length) throw new ToolError("No such blocked nights.");
    return { status: "removed", from: data[0].starts_on, until: data[0].ends_on };
  }) as never);

  server.registerTool("performance_summary", {
    title: "How the business is doing",
    description:
      "Sply Performance: the figures of the last closed month (occupancy, rate per night, income, result, against last year), where the business "
      + "stands against its goals (e.g. break even by a date: what it needs per month and the pace), and the actions proposed. "
      + "Use when the user asks how things are going, about occupancy, prices, profit, return on investment or their goals. Admins only. "
      + "Quote the figures as given; do not compute new ones.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }, (async (s: Session) => {
    requireAdmin(s);
    const day = today(s);
    const closed = await lastClosedMonth(s.db, s.org.id);
    const month = closed ?? addMonths(monthOf(day), -1);
    const { data: report } = await s.db.from("performance_reports").select("id, status").eq("organization_id", s.org.id).eq("month", month).maybeSingle();
    const view = report?.status === "ready" || report?.status === "failed" ? await reportView(s.db, s.org.id, report.id) : null;
    const f = view?.facts ?? facts(await loadData(s.db, s.org.id), month, day, s.org.reportingCurrency);
    const pick = (k: string) => (f.metrics[k] ? show(f.metrics[k], f.currency) : null);
    const kpis = Object.fromEntries(["occupancy", "adr", "revpar", "income", "expenses", "operating", "result", "sold", "blocked"].map((k) => [k, {
      label: f.metrics[`month.${k}`]?.label ?? k, this_month: pick(`month.${k}`), same_month_last_year: pick(`last_year.${k}`), three_months_before: pick(`prev3.${k}`),
    }]).filter(([, v]) => (v as { this_month: string | null }).this_month));
    return {
      month: month.slice(0, 7),
      closed: !!closed,
      note: closed ? null : "No month is closed yet: these figures can still change.",
      headline: view?.analysis?.headline ?? null,
      figures: kpis,
      goals: goalLines(f).map(strip),
      next_60_days: { booked: f.calendar.booked, free: f.calendar.free, gaps_too_short: f.calendar.orphanNights },
      actions: (view?.actions ?? []).map((a) => ({ title: a.title, why: a.why, status: a.status, due: a.dueOn })),
      missing: f.missing,
      report: performanceLink(month),
    };
  }) as never);
}
