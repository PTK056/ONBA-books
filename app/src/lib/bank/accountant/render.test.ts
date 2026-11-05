import { test } from "node:test";
import assert from "node:assert/strict";
import { isSure, lineLabel, oneChargePerStatement, proposalLabel, telegramText, type ProposalView } from "./render.ts";

const view = (over: Partial<ProposalView> = {}): ProposalView => ({
  id: "p1", runId: "r1", lineId: "l1", action: "add", status: "pending", confidence: "high", why: "Like the last 3 payments to PLN",
  question: null, outcome: null, amountDiffers: false,
  line: { date: "2026-10-03", direction: "out", amount: 850000, currency: "IDR", counterparty: "PLN", description: "PLN POSTPAID" },
  villa: "Casa ONBA", category: "Utilities", description: "Electricity", entry: null, stays: [], personalReason: null,
  statementId: "s1", telegram: [], ...over,
});

test("labels read like the Bank tab", () => {
  assert.equal(lineLabel(view()), "03/10 · −850,000 IDR · PLN");
  assert.equal(proposalLabel(view()), "Add to the books: Utilities · Casa ONBA · Electricity");
  assert.equal(proposalLabel(view({ action: "link", entry: { date: "2026-10-02", amount: 850000, currency: "IDR", description: "PLN electricity" } })),
    "Already in the books: 02/10 PLN electricity (850,000 IDR)");
  assert.equal(proposalLabel(view({ action: "link_stays", stays: [{ guest: "Lea", reference: "HM1", checkIn: "2026-10-01" }, { guest: null, reference: "HM2", checkIn: "2026-10-02" }] })),
    "Pays the stays of Lea, HM2");
  assert.equal(proposalLabel(view({ action: "personal", personalReason: "owner_transfer" })), "Personal: owner transfer");
});

test("Telegram text escapes bank text and shows the decision", () => {
  const t = telegramText(view({ line: { ...view().line, counterparty: "<b>PT A&B</b>" }, status: "failed", outcome: "That month is closed." }));
  assert.ok(t.includes("&lt;b&gt;PT A&amp;B&lt;/b&gt;"));
  assert.ok(t.endsWith("⚠️ Not applied: That month is closed."));
  assert.ok(telegramText(view({ amountDiffers: true, action: "link" })).includes("The amount differs"));
  assert.ok(telegramText(view({ action: "ask", question: "What is raja niaga?" })).includes("Reply in this chat"));
});

test("sure ones are high confidence with something to apply", () => {
  assert.equal(isSure(view()), true);
  assert.equal(isSure(view({ confidence: "medium" })), false);
  assert.equal(isSure(view({ action: "ask" })), false);
});

test("a statement's charges count once", () => {
  const vs = [view({ id: "a", action: "charges" }), view({ id: "b", action: "charges" }), view({ id: "c", action: "charges", statementId: "s2" }), view({ id: "d" })];
  assert.deepEqual(oneChargePerStatement(vs).map((v) => v.id), ["a", "c", "d"]);
});
