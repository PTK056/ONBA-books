import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInput, check, show, type Answer } from "./analyze.ts";
import type { Facts } from "./metrics.ts";
import { actionData, reportButtons, reportText, type ReportView } from "./render.ts";

const facts = (): Facts => ({
  engine: 1, month: "2026-10-01", currency: "IDR", generatedOn: "2026-11-05",
  metrics: {
    "month.occupancy": { label: "Occupancy", value: 0.4091, unit: "percent" },
    "last_year.occupancy": { label: "Occupancy, same month last year", value: 0.55, unit: "percent" },
    "month.adr": { label: "ADR", value: 2_231_000, unit: "money" },
    "month.income": { label: "Income", value: 20_079_252, unit: "money" },
    "month.operating": { label: "Operating result (before Lease, paid ahead)", value: 9_500_000, unit: "money" },
    "goal.1.cumulative": { label: "Break even: cumulative", value: -77_000_000, unit: "money" },
    "goal.1.required_per_month": { label: "needed", value: 30_200_000, unit: "money" },
    "goal.1.pace3": { label: "pace", value: 21_000_000, unit: "money" },
    "goal.1.projected": { label: "projected", value: -50_000_000, unit: "money" },
    "calendar.orphan_nights": { label: "orphans", value: 4, unit: "nights" },
  },
  months: [], anomalies: [], prepaid: ["Lease"], missing: ["No same month last year to compare with."],
  goals: [{
    key: "goal.1", id: "g", label: "Break even", placeId: null, since: "2024-10-01", byDate: "2027-04-30", target: 0, invested: 599_000_000, planned: 0, plannedNote: null,
    cumulative: -77_000_000, bookedNet: 20_000_000, committed: 104_000_000, monthsLeft: 6, requiredPerMonth: 30_200_000, pace3: 21_000_000,
    lastYearSame: 131_000_000, projected: -50_000_000, projectedAtPace: -55_000_000, reached: false, over: false, roi: -0.128,
  }],
  calendar: { from: "2026-11-05", days: 60, available: 60, booked: 20, blocked: 0, free: 40, orphanNights: 4, gaps: [], lastYearOccupancy: 0.6, strip: [{ villa: "Casa", days: "b".repeat(60) }] },
});

const answer = (over: Partial<Answer> = {}): Answer => ({
  headline: "October missed last year's occupancy by 14 points; break even by April needs 30.2M a month, the pace is 21M.",
  wins: [{ text: "ADR held at 2.2M.", metrics: ["month.adr"] }, { text: "Invented.", metrics: ["month.vibes"] }],
  issues: [{ text: "Occupancy 40.9% against 55%.", metrics: ["month.occupancy", "last_year.occupancy"] }],
  goals: "Behind: 9.2M a month short of the pace needed.",
  previous: null,
  actions: [
    { title: "Open 2-night stays for the gaps", why: "4 orphan nights in the next 60 days.", metrics: ["calendar.orphan_nights"], impact_per_month: 4_400_000, impact_note: "4 nights × 50% sold × ADR 2.2M", effort: "low", due: "2026-11-15", villa: "casa" },
    { title: "No figures", why: "w", metrics: ["nope"], impact_per_month: 1, impact_note: "x", effort: "low", due: "2026-11-15", villa: null },
    { title: "Raise the weekend rate", why: "w", metrics: ["month.adr"], impact_per_month: 2_000_000, impact_note: "", effort: "medium", due: "2027-06-01", villa: null },
    { title: "Third", why: "w", metrics: ["month.income"], impact_per_month: null, impact_note: "", effort: "high", due: "soon", villa: "Elsewhere" },
    { title: "Fourth", why: "w", metrics: ["month.income"], impact_per_month: null, impact_note: "", effort: "high", due: "2026-11-20", villa: null },
  ],
  ...over,
});

test("only what rests on computed figures is kept", () => {
  const c = check(answer(), facts(), [{ id: "v1", name: "Casa" }]);
  assert.deepEqual(c.analysis.wins.map((w) => w.text), ["ADR held at 2.2M."]);
  assert.equal(c.analysis.issues.length, 1);
  assert.deepEqual(c.actions.map((a) => a.title), ["Open 2-night stays for the gaps", "Raise the weekend rate", "Third"], "three at most, the one without figures dropped");
  assert.deepEqual(c.actions.map((a) => a.position), [1, 2, 3]);
  assert.equal(c.dropped.length, 2);
});

test("an estimate needs how it was made; a due date is near; the villa is one of theirs", () => {
  const [a, b, d] = check(answer(), facts(), [{ id: "v1", name: "Casa" }]).actions;
  assert.equal(a.impact, 4_400_000);
  assert.equal(a.villaId, "v1", "matched by name, any case");
  assert.equal(a.dueOn, "2026-11-15");
  assert.equal(b.impact, null, "no hypothesis, no estimate");
  assert.equal(b.dueOn, null, "more than 90 days away");
  assert.equal(d.dueOn, null);
  assert.equal(d.villaId, null, "an unknown villa is not guessed");
});

test("Claude reads figures, labels and its own past actions, nothing else", () => {
  const input = buildInput(facts(), { name: "Onba", villas: ["Casa"] }, []);
  const json = JSON.stringify(input);
  assert.ok(!json.includes("bbbbbbbb"), "no per-day calendar");
  assert.equal(input.metrics["month.occupancy"].reads, "40.9%");
  assert.equal(input.metrics["goal.1.cumulative"].reads, "−77.0M IDR");
  assert.equal(show({ label: "", value: 1_234_567_890, unit: "money" }, "IDR"), "1.23B IDR");
});

const view = (over: Partial<ReportView> = {}): ReportView => {
  const c = check(answer(), facts(), [{ id: "v1", name: "Casa" }]);
  return {
    month: "2026-10-01", facts: facts(), analysis: c.analysis, last: { total: 3, done: 2 },
    actions: c.actions.map((a, i) => ({ id: `0000000${i}-0000-4000-8000-000000000000`, position: a.position, title: a.title, why: a.why, impact: a.impact, impactNote: a.impactNote, effort: a.effort, dueOn: a.dueOn, status: i === 1 ? "accepted" : "proposed" })),
    ...over,
  };
};

test("the Telegram report: the month, four figures, the goal, the actions with their buttons", () => {
  const html = reportText(view(), "https://app/performance?month=2026-10");
  assert.match(html, /📈 Sply Performance<\/b> · October 2026/);
  assert.match(html, /Occupancy <b>40\.9%<\/b> <i>\(last year 55\.0%\)<\/i>/);
  assert.match(html, /Result before Lease <b>9\.5M IDR<\/b>/);
  assert.match(html, /🎯 <b>Break even<\/b> by 30 Apr 2027: −77\.0M IDR so far; needs 30\.2M IDR a month before Lease, last 3 months: 21\.0M IDR → 50\.0M IDR short at this rate\./);
  assert.match(html, /Last month: 2 of 3 actions done\./);
  assert.match(html, /1\. <b>Open 2-night stays for the gaps<\/b>/);
  assert.match(html, /≈ \+4\.4M IDR\/month · effort low · by 15 Nov/);
  assert.match(html, /in your tasks ✅/);
  const buttons = reportButtons(view(), "https://app/performance");
  assert.equal(buttons.length, 3, "two proposed actions and the link");
  assert.deepEqual(buttons[0][0], { text: "➕ 1. Add to my tasks", data: actionData("00000000-0000-4000-8000-000000000000") });
  assert.ok(Buffer.byteLength(actionData("00000000-0000-4000-8000-000000000000")) <= 64);
});

test("a long report fits Telegram without breaking its markup", () => {
  const long = "x".repeat(300);
  const v = view();
  v.analysis = { ...v.analysis!, headline: long, wins: [1, 2, 3].map(() => ({ text: long })), issues: [1, 2, 3].map(() => ({ text: long })) };
  v.actions = v.actions.map((a) => ({ ...a, title: long.slice(0, 120), why: long + long }));
  const html = reportText(v, "https://app");
  assert.ok(html.length <= 4096, `${html.length}`);
  assert.equal((html.match(/<b>/g) ?? []).length, (html.match(/<\/b>/g) ?? []).length);
  assert.match(html, /Full report/);
});

test("figures without Claude's analysis still go out, and say so", () => {
  const html = reportText(view({ analysis: null, actions: [] }), "https://app");
  assert.match(html, /could not write its analysis/);
  assert.match(html, /Occupancy <b>40\.9%<\/b>/);
});

test("names are escaped and Claude's text carries no links", () => {
  const f = facts();
  f.prepaid = ["Lease & <rent>"];
  const html = reportText(view({ facts: f }), "https://app");
  assert.match(html, /Result before Lease &amp; &lt;rent&gt; <b>/);
  const c = check(answer({ headline: "Go to https://evil.example/x now", actions: [{ ...answer().actions[0], why: "See www.evil.example for more", impact_per_month: 1e20 }] }), facts(), []);
  assert.doesNotMatch(c.analysis.headline, /evil/);
  assert.doesNotMatch(c.actions[0].why, /evil/);
  assert.equal(c.actions[0].impact, null, "an absurd estimate is dropped");
});
