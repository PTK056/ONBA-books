import { test } from "node:test";
import assert from "node:assert/strict";
import { closeData, closingText, coverage, monthEnd, previousMonth, scheduledFor, weeklyText, type ClosingReport } from "./closing.ts";

const links = { bank: "https://app/bank", review: "https://app/review", missing: "https://app/missing" };

test("the day decides: closing on the 10th, reminder on the 15th, review on Mondays", () => {
  assert.equal(scheduledFor("2026-11-10"), "closing"); // a Tuesday
  assert.equal(scheduledFor("2026-11-15"), "closing_reminder"); // a Sunday
  assert.equal(scheduledFor("2026-11-09"), "weekly"); // a Monday
  assert.equal(scheduledFor("2027-05-10"), "closing"); // a Monday: the closing, not both
  assert.equal(scheduledFor("2026-11-11"), null);
});

test("last month, and its last day", () => {
  assert.equal(previousMonth("2026-11-10"), "2026-10-01");
  assert.equal(previousMonth("2027-01-10"), "2026-12-01");
  assert.equal(monthEnd("2026-02-01"), "2026-02-28");
  assert.equal(monthEnd("2028-02-01"), "2028-02-29");
  const data = closeData("8f0c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b", "2026-10-01");
  assert.equal(data, "mc:8f0c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b:2026-10");
  assert.ok(Buffer.byteLength(data) <= 64, "fits Telegram's callback data");
});

test("statements cover a month when their periods, merged, span all of it", () => {
  assert.equal(coverage([{ start: "2026-09-25", end: "2026-10-31" }], "2026-10-01").kind, "full");
  assert.equal(coverage([{ start: "2026-10-01", end: "2026-10-15" }, { start: "2026-10-16", end: "2026-11-05" }], "2026-10-01").kind, "full");
  const gap = coverage([{ start: "2026-10-01", end: "2026-10-12" }, { start: "2026-10-20", end: "2026-10-31" }], "2026-10-01");
  assert.deepEqual(gap, { kind: "partial", ranges: [["2026-10-01", "2026-10-12"], ["2026-10-20", "2026-10-31"]] });
  assert.equal(coverage([{ start: "2026-09-01", end: "2026-09-30" }, { start: null, end: null }], "2026-10-01").kind, "none");
});

test("the weekly review says only what needs the owner, and nothing when nothing does", () => {
  const none = { linesToDo: 0, withProposal: 0, questions: 0, receiptsToReview: 0, missingReceipts: { count: 0, latest: [] } };
  assert.equal(weeklyText(none, links), null);
  const text = weeklyText({ ...none, linesToDo: 5, withProposal: 3, questions: 1, missingReceipts: { count: 1, latest: [
    { date: "2026-10-03", amount: 850000, currency: "IDR", description: "PLN <electricity>" },
  ] } }, links)!;
  assert.match(text, /2 proposals to decide, 1 question/);
  assert.match(text, /2 bank lines I could not explain/);
  assert.match(text, /1 expense without a receipt/);
  assert.match(text, /PLN &lt;electricity&gt;/, "bank and receipt text is escaped");
  assert.doesNotMatch(text, /receipts? waiting/);
  assert.match(weeklyText({ ...none, linesToDo: 1, withProposal: 1, questions: 1 }, links)!, /🔎 1 question:/);
});

const report = (over: Partial<ClosingReport> = {}): ClosingReport => ({
  month: "2026-10-01",
  accounts: [
    { name: "Danamon ••••4821", coverage: { kind: "full", ranges: [["2026-10-01", "2026-10-31"]] } },
    { name: "Wise", coverage: { kind: "none", ranges: [] } },
  ],
  linesToDo: 0, receiptsToReview: 0, missingReceipts: { count: 0, latest: [] },
  places: [{ name: "Casa ONBA", closed: false }, { name: "Company", closed: false }],
  ...over,
});

test("a missing statement is said, but never stops the closing", () => {
  const r = closingText(report(), false, links)!;
  assert.equal(r.ready, true);
  assert.match(r.html, /Nothing left to do for October 2026/);
  assert.match(r.html, /Wise: no statement for October \(fine if nothing moved\)/);
  assert.doesNotMatch(r.html, /Danamon/, "a fully covered account is not mentioned");
  assert.match(r.html, /To close: Casa ONBA, Company/);
});

test("what is left to do is listed, and the reminder says so", () => {
  const r = closingText(report({ linesToDo: 3, receiptsToReview: 2 }), true, links)!;
  assert.equal(r.ready, false);
  assert.match(r.html, /Reminder: closing October 2026/);
  assert.match(r.html, /3 bank lines of October still to do/);
  assert.match(r.html, /2 receipts waiting/);
});

test("no closing message once every place is closed; only open places are named", () => {
  assert.equal(closingText(report({ places: [{ name: "Casa ONBA", closed: true }] }), false, links), null);
  const r = closingText(report({ places: [{ name: "Casa ONBA", closed: true }, { name: "Company", closed: false }] }), false, links)!;
  assert.match(r.html, /To close: Company\./);
});
