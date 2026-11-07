// How a proposal reads, in the Bank tab and in Telegram. Pure, so it can be tested without a database.

export interface ProposalView {
  id: string; runId: string; lineId: string;
  action: "add" | "link" | "link_stays" | "personal" | "charges" | "ask";
  status: "pending" | "accepted" | "applied" | "rejected" | "stale" | "failed";
  confidence: "high" | "medium" | "low";
  why: string; question: string | null; outcome: string | null; amountDiffers: boolean;
  line: { date: string; direction: "in" | "out"; amount: number; currency: string; counterparty: string | null; description: string };
  villa: string | null; category: string | null; description: string | null;
  entry: { date: string; amount: number; currency: string; description: string | null } | null;
  stays: { guest: string | null; reference: string | null; checkIn: string }[];
  personalReason: string | null;
  statementId: string | null;
  telegram: { chat: string; message: number }[];
}

export const SIGNATURE = "🧾 Sply Accountant";

const REASON: Record<string, string> = {
  owner_transfer: "owner transfer", owner_contribution: "owner contribution", private_expense: "private expense", internal_transfer: "between own accounts",
};

export const money = (n: number, cur: string) => `${n.toLocaleString("en", { maximumFractionDigits: 2 })} ${cur}`;
const day = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Cut before escaping, so a message never ends inside an HTML entity or tag. */
const cut = (s: string | null | undefined, n: number) => ((s ?? "").length > n ? `${(s ?? "").slice(0, n - 1)}…` : s ?? "");

/** The line, in one short line: "03/10 · −850,000 IDR · PLN". */
export function lineLabel(v: Pick<ProposalView, "line">): string {
  const l = v.line;
  return [day(l.date), `${l.direction === "in" ? "+" : "−"}${money(l.amount, l.currency)}`, cut(l.counterparty ?? l.description, 60)].join(" · ");
}

/** What Sply proposes, in a few words. */
export function proposalLabel(v: ProposalView): string {
  switch (v.action) {
    case "add": return `Add to the books: ${[v.category, v.villa, v.description].filter(Boolean).join(" · ")}`;
    case "link": return v.entry
      ? `Already in the books: ${day(v.entry.date)} ${v.entry.description ?? ""} (${money(v.entry.amount, v.entry.currency)})`.replace(/\s+\(/, " (")
      : "Already in the books";
    case "link_stays": return `Pays ${v.stays.length > 1 ? "the stays" : "the stay"} of ${v.stays.map((x) => x.guest ?? x.reference ?? day(x.checkIn)).join(", ")}`;
    case "personal": return v.personalReason === "returned"
      ? "Sent back: cancels out, nothing to book" : `Personal: ${REASON[v.personalReason ?? ""] ?? "not in the books"}`;
    case "charges": return "Bank charges: booked with the statement's other charges, one entry a month";
    case "ask": return v.question ?? "Sply has a question";
  }
}

const STATUS: Record<ProposalView["status"], string> = {
  pending: "", accepted: "⏳ Applying…", applied: "✅ Done", rejected: "✖ Declined", stale: "↪ Already handled", failed: "⚠️ Not applied",
};

/** The decision, once made: "✅ Done", or why it failed. */
export function statusLabel(v: ProposalView): string {
  const s = STATUS[v.status];
  return v.outcome && v.status !== "applied" ? `${s}: ${v.outcome}` : s;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** One proposal as a Telegram message (HTML). */
export function telegramText(v: ProposalView): string {
  const lines = [
    `<b>${escapeHtml(lineLabel(v))}</b>`,
    `${v.action === "ask" ? "❓" : "→"} ${escapeHtml(cut(proposalLabel(v), 450))}`,
  ];
  if (v.amountDiffers && v.action !== "ask") lines.push("⚠️ The amount differs: OK links it anyway, nothing is booked for the gap.");
  if (v.why && v.action !== "ask") lines.push(`<i>${escapeHtml(cut(v.why, 450))}</i>`);
  if (v.action === "ask" && v.status === "pending") lines.push("<i>Reply in this chat, or handle it in the Bank tab.</i>");
  const status = statusLabel(v);
  if (status) lines.push(escapeHtml(cut(status, 450)));
  return lines.join("\n");
}

/** "Sure": high confidence and an action to apply. The ones "OK all" accepts. */
export const isSure = (v: Pick<ProposalView, "confidence" | "action">) => v.confidence === "high" && v.action !== "ask";

/** Charges proposals of one statement are decided together: keep the first of each. */
export function oneChargePerStatement<T extends Pick<ProposalView, "action" | "statementId">>(views: T[]): T[] {
  const seen = new Set<string>();
  return views.filter((v) => {
    if (v.action !== "charges") return true;
    if (seen.has(v.statementId ?? "")) return false;
    seen.add(v.statementId ?? "");
    return true;
  });
}
