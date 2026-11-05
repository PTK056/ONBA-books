// How a Sply Performance report reads in Telegram. Pure, so it can be tested without a database or Telegram.

import { escapeHtml } from "../bank/accountant/render.ts";
import { show } from "./analyze.ts";
import type { Facts } from "./metrics.ts";

export const SIGNATURE = "📈 Sply Performance";

export interface ReportView {
  month: string;
  facts: Facts;
  analysis: {
    headline: string; wins: { text: string }[]; issues: { text: string }[]; goals: string | null; previous: string | null;
  } | null;
  actions: { id: string; position: number; title: string; why: string; impact: number | null; impactNote: string | null; effort: string; dueOn: string | null; status: string }[];
  /** Last month's actions: how many, how many done. */
  last: { total: number; done: number } | null;
}

export const monthName = (month: string) =>
  new Date(`${month.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" });
const dayMonth = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const fullDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Button data: pa:<action id> adds it to the tasks (39 bytes). */
export const actionData = (id: string) => `pa:${id}`;

/** One figure and how it compares: "41.0% (Oct 2025: 55.2%)". */
function kpi(f: Facts, key: string, label: string): string | null {
  const m = f.metrics[`month.${key}`];
  if (!m) return null;
  const ly = f.metrics[`last_year.${key}`];
  const p3 = f.metrics[`prev3.${key}`];
  const vs = ly ? `last year ${show(ly, f.currency)}` : p3 ? `3 months before ${show(p3, f.currency)}` : null;
  return `${escapeHtml(label)} <b>${escapeHtml(show(m, f.currency))}</b>${vs ? ` <i>(${escapeHtml(vs)})</i>` : ""}`;
}

/** Where each goal stands, in one or two lines. */
export function goalLines(f: Facts): string[] {
  return f.goals.map((g) => {
    const m = (k: string) => f.metrics[`${g.key}.${k}`];
    const cum = m("cumulative");
    const head = `🎯 <b>${escapeHtml(g.label)}</b> by ${escapeHtml(fullDay(g.byDate))}: ${cum ? escapeHtml(show(cum, f.currency)) : "—"} so far`;
    if (g.over) return `${head} (${g.reached ? "reached ✅" : "not reached"}).`;
    if (g.reached && !g.requiredPerMonth) return `${head} ✅`;
    const need = m("required_per_month"), pace = m("pace3"), proj = m("projected") ?? m("projected_at_pace");
    const parts = [
      need ? `needs ${escapeHtml(show(need, f.currency))} a month${f.prepaid.length ? ` before ${escapeHtml(f.prepaid.join(", "))}` : ""}` : null,
      pace ? `last 3 months: ${escapeHtml(show(pace, f.currency))}` : null,
    ].filter(Boolean);
    const verdict = proj && proj.value !== null ? (proj.value >= g.target ? " → on track" : ` → ${escapeHtml(show({ ...proj, value: g.target - proj.value }, f.currency))} short at this rate`) : "";
    return `${head}; ${parts.join(", ")}${verdict}.`;
  });
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The report for Telegram (at most 4096 characters: if long, the wins and issues give way; they stay in the app). */
export function reportText(r: ReportView, link: string): string {
  for (const level of [0, 1, 2] as const) {
    const html = build(r, link, level);
    if (html.length <= 4000) return html;
  }
  return build(r, link, 3);
}

/** level 0: everything; 1: without wins and issues; 2: shorter actions, two goals; 3: the figures and the link. */
function build(r: ReportView, link: string, level: 0 | 1 | 2 | 3): string {
  const points = level === 0;
  const f = r.facts;
  const out = [`<b>${escapeHtml(SIGNATURE)}</b> · ${escapeHtml(monthName(r.month))}`];
  if (r.analysis) out.push(`<i>${escapeHtml(r.analysis.headline)}</i>`);
  out.push("");
  const kpis = [kpi(f, "occupancy", "Occupancy"), kpi(f, "adr", "ADR"), kpi(f, "income", "Income"), kpi(f, "operating", f.prepaid.length ? `Result before ${f.prepaid.join(", ")}` : "Result")]
    .filter(Boolean) as string[];
  out.push(...kpis.map((k) => `• ${k}`));
  const goals = goalLines(f).slice(0, level >= 2 ? 2 : 3);
  if (goals.length && level < 3) out.push("", ...goals);
  if (r.analysis && points) {
    if (r.analysis.wins.length) out.push("", "✅ <b>Went well</b>", ...r.analysis.wins.map((w) => `• ${escapeHtml(cut(w.text, 220))}`));
    if (r.analysis.issues.length) out.push("", "⚠️ <b>To watch</b>", ...r.analysis.issues.map((w) => `• ${escapeHtml(cut(w.text, 220))}`));
  }
  if (r.last?.total) out.push("", `Last month: ${r.last.done} of ${r.last.total} action${r.last.total === 1 ? "" : "s"} done.${r.analysis?.previous ? ` ${escapeHtml(r.analysis.previous)}` : ""}`);
  const shown = shownActions(r);
  if (shown.length && level < 3) {
    out.push("", "👉 <b>This month</b>");
    for (const a of shown) {
      const meta = [
        a.impact !== null ? `≈ ${a.impact >= 0 ? "+" : ""}${escapeHtml(show({ label: "", value: a.impact, unit: "money" }, f.currency))}/month` : null,
        `effort ${a.effort}`, a.dueOn ? `by ${escapeHtml(dayMonth(a.dueOn))}` : null,
        a.status === "accepted" ? "in your tasks ✅" : null,
      ].filter(Boolean).join(" · ");
      out.push(`${a.position}. <b>${escapeHtml(a.title)}</b>: ${escapeHtml(cut(a.why, level >= 2 ? 120 : 260))}`, `   <i>${meta}</i>`);
    }
  } else if (!r.analysis && level < 3) {
    out.push("", "The figures are ready; Sply could not write its analysis this time. Open the report or try /performance again later.");
  }
  if (f.missing.length) out.push("", `ℹ️ ${escapeHtml(f.missing[0])}`);
  out.push("", `<a href="${link}">Full report</a>`);
  return out.join("\n");
}

/** The actions of the latest writing (a rewrite keeps those decided before it, numbered after). At most 5. */
function shownActions(r: ReportView) {
  return r.actions.filter((a) => a.status !== "dismissed").slice(-5);
}

export function reportButtons(r: ReportView, link: string): ({ text: string; data: string } | { text: string; url: string })[][] {
  const rows: ({ text: string; data: string } | { text: string; url: string })[][] = shownActions(r)
    .filter((a) => a.status === "proposed")
    .map((a) => [{ text: `➕ ${a.position}. Add to my tasks`, data: actionData(a.id) }]);
  rows.push([{ text: "Open Performance", url: link }]);
  return rows;
}
