// Reads a bank statement PDF (Danamon first, any bank in principle) with Claude into lines.
// Pure apart from the Claude call, which is passed in, so a script or a test can run it.
// Privacy: the model is asked for counterparty names only; any long digit run left in a text is masked.

import type Anthropic from "@anthropic-ai/sdk";

export const STATEMENT_MODEL = process.env.STATEMENT_MODEL ?? "claude-opus-5-5";

export interface StatementLine {
  date: string;              // YYYY-MM-DD, the transaction (not value) date
  direction: "in" | "out";
  amount: number;            // > 0
  description: string;
  counterparty: string | null;
  reference: string | null;
  balance: number | null;    // running balance after the line, when printed
}

export interface Statement {
  bank: string;
  currency: string;
  account_last4: string | null;
  period_start: string | null;
  period_end: string | null;
  opening_balance: number | null;
  closing_balance: number | null;
  lines: StatementLine[];
  /** Opening + in − out = closing (to the cent), when both balances are printed. */
  balanced: boolean | null;
  notes: string | null;
}

const SYSTEM = `You read bank account statements for a bookkeeping app and return every transaction line as JSON.

Rules:
- One output line per transaction line of the statement, in the order printed, across all pages. Skip headers, page totals, opening/closing balance rows and summary tables.
- date: the transaction date as YYYY-MM-DD. Statements print the year once, in the period; use it.
- direction: "out" for debits (withdrawals, transfers out, fees, tax), "in" for credits. amount is always positive.
- Indonesian statements use "." for thousands and "," for decimals (1.250.000,00 = 1250000). Read amounts exactly.
- description: the transaction text, on one line, without account numbers.
- counterparty: the person or company paid or paying, by name only, if printed; else null. Never an account number.
- reference: a transaction or transfer reference if printed; else null.
- balance: the running balance printed on that line, else null.
- account_last4: the last 4 characters of the statement's own account number. Never return a full account number anywhere.
- opening_balance / closing_balance: as printed for the period, else null.
- notes: only a problem the person must act on (unreadable rows, missing pages, totals that do not add up), in one short plain sentence; else null. Do not describe what you removed or how you read it.`;

const LINE = {
  type: "object",
  additionalProperties: false,
  required: ["date", "direction", "amount", "description", "counterparty", "reference", "balance"],
  properties: {
    date: { type: "string" },
    direction: { type: "string", enum: ["in", "out"] },
    amount: { type: "number" },
    description: { type: "string" },
    counterparty: { type: ["string", "null"] },
    reference: { type: ["string", "null"] },
    balance: { type: ["number", "null"] },
  },
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["bank", "currency", "account_last4", "period_start", "period_end", "opening_balance", "closing_balance", "lines", "notes"],
  properties: {
    bank: { type: "string" },
    currency: { type: "string" },
    account_last4: { type: ["string", "null"] },
    period_start: { type: ["string", "null"] },
    period_end: { type: ["string", "null"] },
    opening_balance: { type: ["number", "null"] },
    closing_balance: { type: ["number", "null"] },
    lines: { type: "array", items: LINE },
    notes: { type: ["string", "null"] },
  },
};

export class StatementError extends Error {}

type Client = Pick<Anthropic, "beta">;

export async function readStatementPdf(client: Client, pdfBase64: string): Promise<Statement> {
  if (/\/Encrypt\s+\d+\s+\d+\s+R|\/Encrypt\s*<</.test(Buffer.from(pdfBase64, "base64").toString("latin1"))) {
    throw new StatementError("This PDF is locked with a password. Open it and save an unlocked copy, then add that one.");
  }
  // Streamed: a long statement can take minutes, more than a plain request may wait.
  const response = await client.beta.messages.stream({
    model: STATEMENT_MODEL,
    max_tokens: 64000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
        { type: "text", text: "Read this bank statement." },
      ],
    }],
  }).finalMessage();
  if (response.stop_reason === "refusal") throw new StatementError("The statement could not be read.");
  if (response.stop_reason === "max_tokens") throw new StatementError("The statement is too long to read in one go. Add it one month at a time.");
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  try {
    return normalizeStatement(JSON.parse(text));
  } catch (e) {
    throw e instanceof StatementError ? e : new StatementError("The statement could not be read.");
  }
}

/** Cleans what the model returned and checks it adds up. */
export function normalizeStatement(raw: Omit<Statement, "balanced">): Statement {
  const currency = String(raw.currency ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new StatementError(`Unknown currency "${raw.currency}".`);
  const lines: StatementLine[] = [];
  for (const l of raw.lines ?? []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(l.date) || isNaN(Date.parse(l.date)) || !(l.amount > 0)) continue;
    lines.push({
      date: l.date,
      direction: l.direction === "in" ? "in" : "out",
      amount: round2(l.amount),
      description: mask(l.description ?? "").trim(),
      counterparty: l.counterparty ? mask(l.counterparty).trim() || null : null,
      reference: l.reference ? mask(l.reference).trim() || null : null,
      balance: l.balance ?? null,
    });
  }
  const dropped = (raw.lines?.length ?? 0) - lines.length;
  const sum = lines.reduce((s, l) => s + (l.direction === "in" ? l.amount : -l.amount), 0);
  const balanced = raw.opening_balance != null && raw.closing_balance != null
    ? Math.abs(round2(raw.opening_balance + sum) - raw.closing_balance) < 0.01
    : null;
  const notes = [raw.notes, dropped ? `${dropped} line(s) without a valid date or amount were left out.` : null]
    .filter(Boolean).join(" ") || null;
  const last4 = raw.account_last4 ? String(raw.account_last4).replace(/\W/g, "").slice(-4) || null : null;
  return { ...raw, currency, account_last4: last4, lines, balanced, notes };
}

/** Masks account and card numbers: any run of 6+ digits keeps its last 4. */
export function mask(s: string): string {
  return s.replace(/\d[\d -]{4,}\d/g, (run) => {
    const digits = run.replace(/\D/g, "");
    return digits.length >= 6 ? `••••${digits.slice(-4)}` : run;
  });
}

const round2 = (n: number) => Math.round(n * 100) / 100;
