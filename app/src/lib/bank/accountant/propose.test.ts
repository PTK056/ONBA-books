import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInput, toDrafts, type Answer, type Dossier, type OrgNames } from "./propose.ts";

const org: OrgNames = {
  reportingCurrency: "IDR",
  villas: [{ id: "v-onba", name: "Casa ONBA" }],
  company: { id: "v-co", name: "Onba PM" },
  categories: [
    { id: "c-util", name: "Utilities", kind: "expense" },
    { id: "c-bank", name: "Bank fees", kind: "expense" },
    { id: "c-rent", name: "Rental income", kind: "income" },
  ],
};

const entry = (over: Partial<Dossier["entries"][number]> = {}): Dossier["entries"][number] => ({
  ref: "E1", transactionId: "tx-1", date: "2026-10-02", amount: 850000, currency: "IDR", description: "PLN electricity",
  category: "Utilities", villa: "Casa ONBA", score: 0.9, reasons: ["same amount"], gap: 0, paidBy: null, ...over,
});
const stay = (over: Partial<Dossier["stays"][number]> = {}): Dossier["stays"][number] => ({
  ref: "S1", stayId: "st-1", reference: "HM1", guest: "Lea", platform: "airbnb", checkIn: "2026-10-01", checkOut: "2026-10-04",
  netBooked: 4_000_000, linesAlreadyLinked: 0, payoutEmail: null, ...over,
});
const line = (over: Partial<Dossier> = {}): Dossier => ({
  ref: "L1", lineId: "line-1", statementId: "st", date: "2026-10-03", direction: "out", amount: 850000, currency: "IDR",
  counterparty: "PLN", description: "PLN POSTPAID", account: "Danamon", reference: null, usual: null, entries: [], stays: [], ...over,
});
const answer = (p: Partial<Answer["proposals"][number]>): Answer => ({
  proposals: [{ line: "L1", action: "ask", entry: null, stays: null, villa: null, category: null, description: null,
    personal_reason: null, confidence: "high", why: "w", question: null, ...p }],
});

test("a link to a listed entry keeps its id and confidence", () => {
  const [d] = toDrafts(answer({ action: "link", entry: "e1" }), [line({ entries: [entry()] })], org);
  assert.equal(d.action, "link");
  assert.equal(d.transactionId, "tx-1");
  assert.equal(d.confidence, "high");
  assert.equal(d.amountDiffers, false);
});

test("a link whose amount differs is never sure, and says so", () => {
  const [d] = toDrafts(answer({ action: "link", entry: "E1" }), [line({ entries: [entry({ gap: 0.02 })] })], org);
  assert.equal(d.confidence, "medium");
  assert.equal(d.amountDiffers, true);
});

test("an invented entry ref becomes a question", () => {
  const [d] = toDrafts(answer({ action: "link", entry: "E7" }), [line({ entries: [entry()] })], org);
  assert.equal(d.action, "ask");
  assert.equal(d.confidence, "low");
  assert.match(d.question!, /2026-10-03.*850,000 IDR.*PLN/);
});

test("sure is the code's call: personal never, add only like the usual booking, link only the one exact candidate", () => {
  assert.equal(toDrafts(answer({ action: "personal", personal_reason: "owner_transfer" }), [line()], org)[0].confidence, "medium");
  const add = answer({ action: "add", villa: "Casa ONBA", category: "Utilities" });
  assert.equal(toDrafts(add, [line()], org)[0].confidence, "medium");
  const usual = { villa: "Casa ONBA", category: "Utilities", description: "Electricity", times: 3 };
  assert.equal(toDrafts(add, [line({ usual })], org)[0].confidence, "high");
  assert.equal(toDrafts(add, [line({ usual: { ...usual, times: 1 } })], org)[0].confidence, "medium");
  assert.equal(toDrafts(add, [line({ usual, currency: "USD" })], org)[0].confidence, "medium");
  const twins = [entry(), entry({ ref: "E2", transactionId: "tx-2" })];
  assert.equal(toDrafts(answer({ action: "link", entry: "E1" }), [line({ entries: twins })], org)[0].confidence, "medium");
});

test("add resolves names, the company by name or as 'company'", () => {
  const [a] = toDrafts(answer({ action: "add", villa: "casa onba", category: "utilities", description: "  Electricity  " }), [line()], org);
  assert.deepEqual([a.action, a.villaId, a.categoryId, a.description], ["add", "v-onba", "c-util", "Electricity"]);
  const [b] = toDrafts(answer({ action: "add", villa: "Company", category: "Bank fees" }), [line()], org);
  assert.equal(b.villaId, "v-co");
  assert.equal(b.description, "PLN · PLN POSTPAID");
});

test("add with an unknown category, or one of the wrong kind, becomes a question", () => {
  assert.equal(toDrafts(answer({ action: "add", villa: "Casa ONBA", category: "Pool" }), [line()], org)[0].action, "ask");
  assert.equal(toDrafts(answer({ action: "add", villa: "Casa ONBA", category: "Rental income" }), [line()], org)[0].action, "ask");
});

test("link_stays checks the amount against the net or the announced payout", () => {
  const inLine = line({ direction: "in", amount: 4_000_000, stays: [stay()] });
  assert.equal(toDrafts(answer({ action: "link_stays", stays: ["S1"] }), [inLine], org)[0].confidence, "high");
  const deposit = { ...inLine, amount: 1_000_000 };
  const d = toDrafts(answer({ action: "link_stays", stays: ["S1"] }), [deposit], org)[0];
  assert.deepEqual([d.action, d.amountDiffers, d.confidence], ["link_stays", true, "medium"]);
  const announced = { ...inLine, amount: 3_900_000, stays: [stay({ payoutEmail: { amount: 3_900_000, currency: "IDR", sentOn: "2026-10-02", arrivesBy: null } })] };
  assert.equal(toDrafts(answer({ action: "link_stays", stays: ["S1"] }), [announced], org)[0].amountDiffers, false);
});

test("money out never pays a stay", () => {
  assert.equal(toDrafts(answer({ action: "link_stays", stays: ["S1"] }), [line({ stays: [stay()] })], org)[0].action, "ask");
});

test("personal needs a reason that fits the direction", () => {
  assert.equal(toDrafts(answer({ action: "personal", personal_reason: "owner_transfer" }), [line()], org)[0].action, "personal");
  assert.equal(toDrafts(answer({ action: "personal" }), [line()], org)[0].action, "ask");
  assert.equal(toDrafts(answer({ action: "personal", personal_reason: "owner_contribution" }), [line()], org)[0].action, "ask");
});

test("a line Claude skipped still gets a question, and order follows the dossiers", () => {
  const ds = [line(), line({ ref: "L2", lineId: "line-2", counterparty: "raja niaga", amount: 215000 })];
  const drafts = toDrafts(answer({ action: "personal", personal_reason: "owner_transfer" }), ds, org);
  assert.deepEqual(drafts.map((d) => [d.lineId, d.action]), [["line-1", "personal"], ["line-2", "ask"]]);
  assert.match(drafts[1].question!, /raja niaga/);
});

test("Claude's input carries refs and names, never ids", () => {
  const input = JSON.stringify(buildInput({ ...org, name: "Org" }, [line({ entries: [entry()], stays: [stay()] })]));
  for (const id of ["line-1", "tx-1", "st-1", "v-onba", "c-util"]) assert.ok(!input.includes(id), id);
  assert.ok(input.includes('"ref":"E1"') && input.includes('"ref":"S1"'));
});
