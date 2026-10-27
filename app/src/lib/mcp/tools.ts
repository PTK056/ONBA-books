import "server-only";
import { z } from "zod";
import type { AuthInfo, McpServer } from "@modelcontextprotocol/server";
import { allocateByNights, nightsBetween } from "@/lib/stays/airbnb";
import { storeEvidence } from "./files";
import {
  createStaff, describePay, listStaff, logWork, markPaid, monthLabel, payroll, preparePayroll, StaffError, updateStaff,
  type Staff, type StaffInput,
} from "@/lib/staff/ops";
import {
  loadSession, rateFor, requireEditor, resolveCategory, resolveVilla, today, ToolError, type Session,
} from "./session";

import { APP_URL as APP } from "@/lib/app-url";
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const CURRENCY = z.string().regex(/^[A-Za-z]{3}$/, "three-letter code, e.g. IDR").transform((c) => c.toUpperCase());
const UUID = z.string().uuid();
/** How a tool receives a file: MCP clients pass a link or base64; the chat agent points at a file the user sent. */
const FILE_FIELDS = {
  mcp: {
    file_url: z.string().optional().describe("Public https link to the photo or PDF (as received in the chat)."),
    file_base64: z.string().optional().describe("The file itself, base64 (a data: URL is fine). Use when there is no link."),
    mime_type: z.string().optional().describe("e.g. image/jpeg or application/pdf, if known."),
  },
  chat: {
    attachment_id: z.string().optional().describe("Id of a photo or PDF the user sent in this chat, e.g. \"att_1\" (shown next to each file)."),
  },
};
export type Channel = keyof typeof FILE_FIELDS;

/** One tool, shared by the MCP server and the chat agent. */
export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodObject;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
  handler: (s: Session, args: never) => Promise<object>;
}

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

/** Runs a tool for the caller; known problems come back as a readable message, not a crash. */
export async function runTool(t: ToolDef, s: Session, args: unknown): Promise<{ ok: boolean; text: string }> {
  try {
    return { ok: true, text: JSON.stringify(await t.handler(s, args as never), null, 1) };
  } catch (e) {
    if (e instanceof ToolError || e instanceof StaffError) return { ok: false, text: e.message };
    console.error(`[tool ${t.name}]`, e);
    return { ok: false, text: "Something went wrong in Splyce. Try again in a moment." };
  }
}

const friendly = (message = "") =>
  message.includes("closed") ? "That month is closed for this villa. Use a date in an open month, or reopen the month in the app." : null;

type Registrar = { registerTool(name: string, config: Omit<ToolDef, "name" | "handler">, handler: (s: Session, args: never) => Promise<object>): void };

/** The tools, with file fields for the given channel. */
export function toolDefs(channel: Channel): ToolDef[] {
  const defs: ToolDef[] = [];
  define({ registerTool: (name, config, handler) => defs.push({ name, ...config, handler }) }, channel);
  return defs;
}

/** MCP server: each call loads the session from the caller's OAuth token. */
export function registerTools(server: McpServer) {
  for (const t of toolDefs("mcp")) {
    server.registerTool(t.name, { title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations },
      async (args: unknown, ctx: { http?: { authInfo?: AuthInfo } }): Promise<Result> => {
        let s: Session;
        try { s = await loadSession(ctx.http?.authInfo); } catch (e) {
          return { content: [{ type: "text", text: e instanceof ToolError ? e.message : "Could not open Splyce." }], isError: true };
        }
        const r = await runTool(t, s, args);
        return { content: [{ type: "text", text: r.text }], ...(r.ok ? {} : { isError: true }) };
      });
  }
}

function define(server: Registrar, channel: Channel) {
  const file = FILE_FIELDS[channel];
  server.registerTool("get_context", {
    title: "Get context",
    description:
      "Call this first in every conversation. Returns the organization, today's date in its time zone, the villas, "
      + "the income and expense categories and the reporting currency. Use only these villa and category names in other tools; never invent one.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }, (async (s) => ({
    organization: s.org.name,
    your_role: s.role,
    today: today(s),
    reporting_currency: s.org.reportingCurrency,
    villas: s.villas.map((v) => ({ name: v.name, currency: v.currency })),
    company: s.company && { name: s.company.name, use_for: "what belongs to no villa: bank fees and interest, accountant, office, licences, company taxes" },
    expense_categories: s.categories.filter((c) => c.kind === "expense").map((c) => c.name),
    income_categories: s.categories.filter((c) => c.kind === "income").map((c) => c.name),
    evidence_required_from: `${s.org.evidenceThreshold} ${s.org.reportingCurrency} (expenses at or above this need a receipt)`,
  })));

  server.registerTool("submit_receipt", {
    title: "Submit a receipt",
    description:
      "Use when the user sends a photo or PDF of a receipt, invoice or transfer slip for an expense. Splyce reads it "
      + "(merchant, date, total, category, villa) and puts it in the review queue: it is NOT booked until the user validates it in the app. "
      + "Tell the user what was read, point out uncertain fields and possible duplicates, and give the review link. "
      + "One call per file. Do not also call record_transaction for the same expense.",
    inputSchema: z.object({
      ...file,
      villa: z.string().optional().describe("Villa name, if the user said which one. Leave empty to let the reading decide."),
    }),
  }, (async (s, a: { file_url?: string; file_base64?: string; mime_type?: string; attachment_id?: string; villa?: string }) => {
    requireEditor(s);
    const villa = a.villa ? resolveVilla(s, a.villa) : s.villas.length === 1 ? s.villas[0] : null;
    const { data: batch, error } = await s.db.from("receipt_batches")
      .insert({ organization_id: s.org.id, villa_id: villa?.id ?? null }).select("id").single();
    if (error || !batch) throw new ToolError("Could not start the upload. Try again.");
    const ev = await storeEvidence(s, a);
    const { data: item } = await s.db.from("receipt_items")
      .insert({ organization_id: s.org.id, batch_id: batch.id, evidence_id: ev.evidenceId }).select("id").single();
    if (!item) throw new ToolError("Could not queue the receipt. Try again.");

    let quotaReached = false;
    for (let i = 0; i < 3; i++) {
      const { data } = await s.db.functions.invoke<{ remaining: number; quota_reached?: boolean }>("read-receipts", { body: { batch_id: batch.id } });
      quotaReached = !!data?.quota_reached;
      if (!data || data.remaining === 0 || quotaReached) break;
    }
    const { data: read } = await s.db.from("receipt_items").select("proposed, read_at").eq("id", item.id).single();
    const p = (read?.proposed ?? null) as null | Record<string, unknown>;
    if (quotaReached && !read?.read_at) {
      return { status: "queued", message: "Saved, but this month's receipt reading allowance is used up: fill it in from the review queue, or it is read after the 1st.", review: `${APP}/review` };
    }
    if (!read?.read_at || !p) {
      return { status: "queued", message: "Saved. The reading is still running; it will be in the review queue shortly.", review: `${APP}/review` };
    }
    if (p.error) return { status: "queued", message: "Saved, but it could not be read automatically. Fill it in from the review queue.", review: `${APP}/review` };
    return {
      status: "to_review",
      message: p.is_receipt === false ? "This does not look like a receipt. It is in the review queue; reject it there if it is not one." : "Read and waiting in the review queue.",
      read: {
        merchant: p.merchant, date: p.date, total: p.total, currency: p.currency, category: p.category,
        // The villa the review will use: read from the receipt, else the one given (or the only one).
        villa: s.villas.find((v) => v.id === p.villa_id)?.name ?? "(to choose at review)",
        description: p.description, document_type: p.document_type,
      },
      uncertain_fields: p.uncertain_fields ?? [],
      possible_duplicate: p.possible_duplicate_of ? "An entry with the same date and amount already exists." : null,
      review: `${APP}/review`,
    };
  }));

  server.registerTool("record_transaction", {
    title: "Record an expense or income",
    description:
      "Use when the user states an expense or income in words (e.g. \"350k petrol for Kadek, villa Onba, yesterday\"). It is booked immediately. "
      + "Amounts like 350k mean 350000. Resolve relative dates against today from get_context. If the villa or the amount is unclear, ask first. "
      + "Afterwards, repeat what was recorded (date, villa, category, amount) and say it can be undone. "
      + "If the user also sent a photo of the receipt, prefer submit_receipt instead.",
    inputSchema: z.object({
      direction: z.enum(["out", "in"]).describe("out = expense, in = income."),
      amount: z.number().positive().describe("Amount in the given currency, e.g. 350000."),
      currency: CURRENCY.optional().describe("Defaults to the villa's currency."),
      date: DATE.optional().describe("Defaults to today."),
      villa: z.string().optional().describe("Villa name (optional if there is only one villa)."),
      category: z.string().optional().describe("Category name from get_context."),
      description: z.string().max(300).optional().describe("Short description: what and who, e.g. 'Petrol – Kadek'."),
      fx_rate: z.number().positive().optional().describe("Only for a foreign currency with no rate on file: 1 unit = ? reporting currency."),
      ...file,
    }),
  }, (async (s, a: {
    direction: "in" | "out"; amount: number; currency?: string; date?: string; villa?: string; category?: string;
    description?: string; fx_rate?: number; file_url?: string; file_base64?: string; mime_type?: string; attachment_id?: string;
  }) => {
    requireEditor(s);
    const villa = resolveVilla(s, a.villa);
    const category = resolveCategory(s, a.direction === "in" ? "income" : "expense", a.category);
    const currency = a.currency ?? villa.currency;
    const date = a.date ?? today(s);
    const fx = await rateFor(s, currency, a.fx_rate);
    const { data, error } = await s.db.from("transactions").insert({
      organization_id: s.org.id, villa_id: villa.id, date, direction: a.direction, category_id: category?.id ?? null,
      description: a.description?.trim() || null, currency, amount: a.amount, fx_rate: fx, status: "validated", source: "manual",
    }).select("id").single();
    if (error || !data) throw new ToolError(friendly(error?.message) ?? "Could not save. Try again.");
    let receipt = "none";
    if (a.file_url || a.file_base64 || a.attachment_id) {
      await storeEvidence(s, a, data.id);
      receipt = "attached";
    }
    return {
      status: "recorded", transaction_id: data.id,
      recorded: { type: a.direction === "in" ? "income" : "expense", date, villa: villa.name, category: category?.name ?? "(none)", amount: a.amount, currency, description: a.description ?? null },
      receipt,
      needs_receipt: a.direction === "out" && receipt === "none" && a.amount * fx >= s.org.evidenceThreshold,
      undo: "delete_transaction with this transaction_id",
      link: `${APP}/transactions/${data.id}`,
    };
  }));

  server.registerTool("delete_transaction", {
    title: "Undo an entry",
    description: "Deletes an entry that was entered by hand (record_transaction), e.g. when the user says it was a mistake. Confirm with the user before calling.",
    inputSchema: z.object({ transaction_id: UUID }),
    annotations: { destructiveHint: true },
  }, (async (s, a: { transaction_id: string }) => {
    requireEditor(s);
    const { data: tx } = await s.db.from("transactions").select("id, source, date, amount, currency, description")
      .eq("id", a.transaction_id).eq("organization_id", s.org.id).maybeSingle();
    if (!tx) throw new ToolError("No such entry.");
    if (tx.source !== "manual") throw new ToolError("Only entries typed by hand can be deleted here. Correct receipts and stays in the app.");
    const { error } = await s.db.from("transactions").delete().eq("id", tx.id);
    if (error) throw new ToolError(friendly(error.message) ?? "Could not delete. Try again.");
    return { status: "deleted", deleted: { date: tx.date, amount: Number(tx.amount), currency: tx.currency, description: tx.description } };
  }));

  server.registerTool("attach_evidence", {
    title: "Attach a receipt to an entry",
    description: "Adds a photo or PDF as proof to an entry that already exists (find it with find_transactions or get_todo). Allowed in closed months.",
    inputSchema: z.object({ transaction_id: UUID, ...file }),
  }, (async (s, a: { transaction_id: string; file_url?: string; file_base64?: string; mime_type?: string; attachment_id?: string }) => {
    requireEditor(s);
    const { data: tx } = await s.db.from("transactions").select("id, date, amount, currency, description")
      .eq("id", a.transaction_id).eq("organization_id", s.org.id).maybeSingle();
    if (!tx) throw new ToolError("No such entry.");
    await storeEvidence(s, a, tx.id);
    return { status: "attached", entry: { date: tx.date, amount: Number(tx.amount), currency: tx.currency, description: tx.description }, link: `${APP}/transactions/${tx.id}` };
  }));

  server.registerTool("find_transactions", {
    title: "Find entries",
    description: "Searches booked entries. Use to answer questions (\"what did we pay PLN in September?\") or to find an entry to correct or attach a receipt to.",
    inputSchema: z.object({
      from: DATE.optional(), to: DATE.optional(),
      villa: z.string().optional(), category: z.string().optional(),
      direction: z.enum(["out", "in"]).optional(),
      text: z.string().optional().describe("Words in the description."),
      missing_evidence: z.boolean().optional().describe("Only expenses that still need a receipt."),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    annotations: { readOnlyHint: true },
  }, (async (s, a: { from?: string; to?: string; villa?: string; category?: string; direction?: "in" | "out"; text?: string; missing_evidence?: boolean; limit?: number }) => {
    const villa = a.villa ? resolveVilla(s, a.villa) : null;
    const category = a.category ? resolveCategory(s, a.direction === "in" ? "income" : "expense", a.category) : null;
    let q = s.db.from(a.missing_evidence ? "expenses_missing_evidence" : "transactions")
      .select("id, date, direction, amount, currency, amount_reporting, description, source, villa_id, category_id")
      .eq("organization_id", s.org.id).order("date", { ascending: false }).limit(a.limit ?? 20);
    if (a.from) q = q.gte("date", a.from);
    if (a.to) q = q.lte("date", a.to);
    if (villa) q = q.eq("villa_id", villa.id);
    if (category) q = q.eq("category_id", category.id);
    if (a.direction) q = q.eq("direction", a.direction);
    if (a.text) q = q.ilike("description", `%${a.text.replace(/[%_]/g, "")}%`);
    const { data, error } = await q;
    if (error) throw new ToolError("Search failed. Try again.");
    const names = new Map([...s.villas, ...s.categories].map((x) => [x.id, x.name]));
    return {
      count: data.length,
      entries: data.map((t) => ({
        transaction_id: t.id, date: t.date, type: t.direction === "in" ? "income" : "expense",
        amount: Number(t.amount), currency: t.currency, [`amount_${s.org.reportingCurrency}`]: Number(t.amount_reporting),
        villa: names.get(t.villa_id), category: t.category_id ? names.get(t.category_id) : null, description: t.description, source: t.source,
      })),
    };
  }));

  server.registerTool("month_summary", {
    title: "Month summary",
    description: "Income, expenses and net result for a month, in the reporting currency, by villa and by category. Defaults to the current month.",
    inputSchema: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/, "YYYY-MM").optional() }),
    annotations: { readOnlyHint: true },
  }, (async (s, a: { month?: string }) => {
    const month = a.month ?? today(s).slice(0, 7);
    const start = `${month}-01`;
    const [y, m] = month.split("-").map(Number);
    const end = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    const { data, error } = await s.db.from("transactions").select("direction, amount_reporting, villa_id, category_id")
      .eq("organization_id", s.org.id).eq("status", "validated").gte("date", start).lt("date", end);
    if (error) throw new ToolError("Could not load the month. Try again.");
    const names = new Map([...s.villas, ...s.categories].map((x) => [x.id, x.name]));
    const r2 = (n: number) => Math.round(n * 100) / 100;
    let income = 0, expenses = 0;
    const byVilla = new Map<string, { income: number; expenses: number }>();
    const byCat = new Map<string, number>();
    for (const t of data) {
      const v = Number(t.amount_reporting);
      const villa = names.get(t.villa_id) ?? "?";
      const row = byVilla.get(villa) ?? { income: 0, expenses: 0 };
      if (t.direction === "in") { income += v; row.income += v; } else { expenses += v; row.expenses += v; }
      byVilla.set(villa, row);
      const cat = `${t.direction === "in" ? "income" : "expense"}: ${t.category_id ? names.get(t.category_id) : "Uncategorized"}`;
      byCat.set(cat, (byCat.get(cat) ?? 0) + v);
    }
    return {
      month, currency: s.org.reportingCurrency,
      income: r2(income), expenses: r2(expenses), net: r2(income - expenses), entries: data.length,
      by_villa: Object.fromEntries([...byVilla].map(([k, v]) => [k, { income: r2(v.income), expenses: r2(v.expenses), net: r2(v.income - v.expenses) }])),
      by_category: Object.fromEntries([...byCat].sort((x, y) => y[1] - x[1]).map(([k, v]) => [k, r2(v)])),
      link: `${APP}/overview?month=${month}`,
    };
  }));

  server.registerTool("record_stay", {
    title: "Record a stay",
    description:
      "Use for a booking that is not imported from Airbnb: direct, Booking.com, Vrbo… (Airbnb stays come from the CSV import in the app). "
      + "Read the details from the user's message or booking screenshot; ask for any that are missing. Income is spread across months by nights. "
      + "Sending the same booking again updates it instead of duplicating it.",
    inputSchema: z.object({
      platform: z.enum(["direct", "booking", "vrbo", "airbnb", "other"]),
      check_in: DATE, check_out: DATE,
      gross: z.number().positive().describe("Total the guest paid for the stay."),
      fees: z.number().min(0).optional().describe("Platform or agent commission deducted, if any."),
      currency: CURRENCY.optional().describe("Defaults to the villa's currency."),
      villa: z.string().optional(),
      guest: z.string().max(120).optional(),
      reference: z.string().max(60).optional().describe("Booking reference, if any. Keeps re-sends from duplicating."),
      fx_rate: z.number().positive().optional(),
    }),
  }, (async (s, a: {
    platform: "direct" | "booking" | "vrbo" | "airbnb" | "other"; check_in: string; check_out: string; gross: number; fees?: number;
    currency?: string; villa?: string; guest?: string; reference?: string; fx_rate?: number;
  }) => {
    requireEditor(s);
    const nights = nightsBetween(a.check_in, a.check_out);
    if (!(nights > 0)) throw new ToolError("check_out must be after check_in.");
    const villa = resolveVilla(s, a.villa);
    const currency = a.currency ?? villa.currency;
    const fx = await rateFor(s, currency, a.fx_rate);
    const code = (a.reference?.trim() || `${a.check_in}-${(a.guest ?? "guest").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`).slice(0, 60);
    const label = { direct: "Direct", booking: "Booking.com", vrbo: "Vrbo", airbnb: "Airbnb", other: "Stay" }[a.platform];
    const stay = {
      code, listing: villa.name, guest: a.guest ?? null, checkIn: a.check_in, checkOut: a.check_out, nights, currency,
      gross: a.gross, fees: a.fees ?? 0, net: a.gross - (a.fees ?? 0), payoutDate: null, payoutRates: {},
    };
    const { data, error } = await s.db.rpc("import_stays", {
      p_villa: villa.id, p_platform: a.platform,
      p_stays: [{ code, guest: stay.guest, check_in: a.check_in, check_out: a.check_out, currency, gross: stay.gross, fees: stay.fees, payout_date: null, lines: allocateByNights(stay, fx, label) }],
    });
    if (error) throw new ToolError("Could not save the stay. Try again.");
    const r = data as { created: number; updated: number; unchanged: number; conflicts: { reason: string }[] };
    if (r.conflicts.length) throw new ToolError(friendly(r.conflicts[0].reason) ?? "The stay could not be saved.");
    return {
      status: r.created ? "created" : r.updated ? "updated" : "unchanged",
      stay: { villa: villa.name, platform: label, guest: stay.guest, check_in: a.check_in, check_out: a.check_out, nights, gross: a.gross, fees: stay.fees, currency, reference: code },
    };
  }));

  server.registerTool("add_task", {
    title: "Add a task",
    description:
      "Use for any reminder about the villas or their books: a bill or payment to make (kind payment, e.g. \"remind me to pay PLN 850k on the 25th\"), "
      + "a receipt or proof to bring in (kind evidence), or anything else to finish (kind todo). Prefer this over a calendar or a to-do app: "
      + "Splyce tasks come back in get_todo and in the morning brief until done. If the user also wants a calendar alert, add it after this.",
    inputSchema: z.object({
      title: z.string().min(1).max(200).describe("Short, e.g. 'Pay PLN electricity'."),
      kind: z.enum(["payment", "evidence", "todo"]).optional(),
      due_date: DATE.optional(),
      amount: z.number().positive().optional(),
      currency: CURRENCY.optional(),
      villa: z.string().optional(),
      notes: z.string().max(1000).optional(),
    }),
  }, (async (s, a: { title: string; kind?: "payment" | "evidence" | "todo"; due_date?: string; amount?: number; currency?: string; villa?: string; notes?: string }) => {
    requireEditor(s);
    const villa = a.villa ? resolveVilla(s, a.villa) : null;
    const currency = a.amount ? (a.currency ?? villa?.currency ?? s.org.reportingCurrency) : null;
    const { data, error } = await s.db.from("tasks").insert({
      organization_id: s.org.id, villa_id: villa?.id ?? null, kind: a.kind ?? (a.amount ? "payment" : "todo"), title: a.title.trim(),
      notes: a.notes?.trim() || null, due_date: a.due_date ?? null, amount: a.amount ?? null, currency,
    }).select("id").single();
    if (error || !data) throw new ToolError("Could not save the task. Try again.");
    return { status: "added", task_id: data.id, task: { title: a.title, due_date: a.due_date ?? null, amount: a.amount ?? null, currency, villa: villa?.name ?? null } };
  }));

  server.registerTool("complete_task", {
    title: "Complete a task",
    description: "Marks a task as done (find its task_id with get_todo). If it was a payment, offer to record the expense with record_transaction.",
    inputSchema: z.object({ task_id: UUID }),
  }, (async (s, a: { task_id: string }) => {
    requireEditor(s);
    const { data, error } = await s.db.from("tasks").update({ done_at: new Date().toISOString(), done_by: s.userId })
      .eq("id", a.task_id).eq("organization_id", s.org.id).is("done_at", null).select("title, kind, amount, currency").maybeSingle();
    if (error) throw new ToolError("Could not update the task. Try again.");
    if (!data) throw new ToolError("No open task with that id.");
    return { status: "done", task: data };
  }));

  server.registerTool("update_task", {
    title: "Change a task",
    description:
      "Changes an open task: title, due date, amount, villa or notes (find its task_id with get_todo), e.g. \"move the PLN bill to the 30th\". "
      + "Only the fields given change. Repeat the task as it now stands.",
    inputSchema: z.object({
      task_id: UUID,
      title: z.string().min(1).max(200).optional(),
      due_date: DATE.nullable().optional().describe("New due date, or null to remove it."),
      amount: z.number().positive().nullable().optional().describe("New amount, or null to remove it."),
      currency: CURRENCY.optional(),
      villa: z.string().nullable().optional().describe("Villa name, or null for none."),
      notes: z.string().max(1000).nullable().optional(),
    }),
  }, (async (s, a: { task_id: string; title?: string; due_date?: string | null; amount?: number | null; currency?: string; villa?: string | null; notes?: string | null }) => {
    requireEditor(s);
    const { data: task } = await s.db.from("tasks").select("amount, currency, villa_id")
      .eq("id", a.task_id).eq("organization_id", s.org.id).is("done_at", null).maybeSingle();
    if (!task) throw new ToolError("No open task with that id.");
    const villa = a.villa === undefined ? undefined : a.villa === null ? null : resolveVilla(s, a.villa);
    const change: Record<string, unknown> = {};
    if (a.title !== undefined) change.title = a.title.trim();
    if (a.due_date !== undefined) change.due_date = a.due_date;
    if (a.notes !== undefined) change.notes = a.notes?.trim() || null;
    if (villa !== undefined) change.villa_id = villa?.id ?? null;
    if (a.amount === null) { change.amount = null; change.currency = null; }
    else if (a.amount !== undefined || a.currency !== undefined) {
      // Amount and currency go together: keep the current one, else the villa's, else the reporting currency.
      change.amount = a.amount ?? task.amount;
      change.currency = a.currency ?? task.currency ?? villa?.currency ?? s.org.reportingCurrency;
      if (change.amount === null) throw new ToolError("Give the amount too.");
    }
    if (!Object.keys(change).length) throw new ToolError("Nothing to change.");
    const { data, error } = await s.db.from("tasks").update(change).eq("id", a.task_id)
      .select("title, kind, due_date, amount, currency, notes").maybeSingle();
    if (error || !data) throw new ToolError("Could not update the task. Try again.");
    return { status: "updated", task: data };
  }));

  server.registerTool("delete_task", {
    title: "Delete a task",
    description:
      "Deletes a reminder the user no longer wants (find its task_id with get_todo), e.g. one created by mistake or no longer relevant. "
      + "If it was done rather than cancelled, use complete_task instead. Confirm with the user before calling.",
    inputSchema: z.object({ task_id: UUID }),
    annotations: { destructiveHint: true },
  }, (async (s, a: { task_id: string }) => {
    requireEditor(s);
    const { data, error } = await s.db.from("tasks").delete()
      .eq("id", a.task_id).eq("organization_id", s.org.id).select("title, due_date, amount, currency").maybeSingle();
    if (error) throw new ToolError("Could not delete the task. Try again.");
    if (!data) throw new ToolError("No task with that id.");
    return { status: "deleted", task: data };
  }));

  server.registerTool("get_todo", {
    title: "What's left to do",
    description:
      "Everything that needs the user: open tasks and payments (overdue first), staff pay due this month (from each person's payday), receipts waiting for review, expenses of this month and last missing a receipt (older ones: find_transactions with missing_evidence), "
      + "and last month if it is not closed. Use it for a morning brief or when the user asks what is pending. Summarize briefly; offer to help with each item.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }, (async (s) => {
    const day = today(s);
    const [y, m] = day.split("-").map(Number);
    const lastMonth = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
    const [tasks, toReview, unread, missing, closes] = await Promise.all([
      s.db.from("tasks").select("id, kind, title, due_date, amount, currency, villa_id").eq("organization_id", s.org.id)
        .is("done_at", null).order("due_date", { ascending: true, nullsFirst: false }).limit(30),
      s.db.from("receipt_items").select("id", { count: "exact", head: true }).eq("organization_id", s.org.id).eq("status", "pending").not("read_at", "is", null),
      s.db.from("receipt_items").select("id", { count: "exact", head: true }).eq("organization_id", s.org.id).eq("status", "pending").is("read_at", null),
      // Only recent expenses: a receipt from this month or last can still be found; older gaps would be noise every day.
      s.db.from("expenses_missing_evidence").select("id, date, amount, currency, description", { count: "exact" })
        .eq("organization_id", s.org.id).gte("date", lastMonth).lte("date", day).order("date", { ascending: false }).limit(10),
      s.db.from("month_closes").select("villa_id, status").eq("organization_id", s.org.id).eq("month", lastMonth),
    ]);
    const names = new Map(s.villas.map((v) => [v.id, v.name]));
    const closed = new Set((closes.data ?? []).filter((c) => c.status === "closed").map((c) => c.villa_id));
    return {
      today: day,
      tasks: (tasks.data ?? []).map((t) => ({
        task_id: t.id, kind: t.kind, title: t.title, due_date: t.due_date, overdue: !!t.due_date && t.due_date < day,
        amount: t.amount === null ? null : Number(t.amount), currency: t.currency, villa: t.villa_id ? names.get(t.villa_id) : null,
      })),
      receipts_to_review: toReview.count ?? 0,
      receipts_being_read: unread.count ?? 0,
      expenses_missing_receipt: {
        since: lastMonth,
        count: missing.count ?? 0,
        latest: (missing.data ?? []).map((t) => ({ transaction_id: t.id, date: t.date, amount: Number(t.amount), currency: t.currency, description: t.description })),
      },
      payroll_due: await payrollDue(s, day),
      month_to_close: s.villas.filter((v) => !closed.has(v.id)).length
        ? { month: lastMonth.slice(0, 7), villas: s.villas.filter((v) => !closed.has(v.id)).map((v) => v.name) }
        : null,
      review: `${APP}/review`,
    };
  }));

  // ---------------------------------------------------------------- staff
  const MONTH = z.string().regex(/^\d{4}-\d{2}$/, "YYYY-MM");
  const staffSummary = (s: Session, p: Staff) => ({
    staff_id: p.id, name: p.name, role: p.role, type: p.kind, active: p.active, villa: s.villas.find((v) => v.id === p.villa_id)?.name ?? null,
    pay: p.pay_mode === "monthly" ? `${p.monthly_amount} ${p.currency}/month${p.base_unit ? `, base ${p.base_per_week} ${p.base_unit}/week, extra ${p.extra_rate ?? "pay ÷ base"}` : ""}`
      : p.pay_mode === "hourly" ? `${p.hourly_rate} ${p.currency}/hour` : `${p.job_rate} ${p.currency}/job`,
    payday: p.payday,
  });

  async function resolveStaff(s: Session, who: string): Promise<Staff> {
    const people = await listStaff(s.db, s.org.id);
    const w = who.trim().toLowerCase();
    const hit = people.filter((p) => p.id === who || p.name.toLowerCase() === w);
    if (hit.length === 1) return hit[0];
    const partial = people.filter((p) => p.name.toLowerCase().includes(w) || w.includes(p.name.toLowerCase()));
    if (partial.length === 1) return partial[0];
    throw new ToolError(people.length ? `Who is "${who}"? Team: ${people.map((p) => p.name).join(", ")}. Add them with save_staff if new.` : "No one in the team yet. Add people with save_staff.");
  }

  server.registerTool("list_staff", {
    title: "List the team",
    description: "The people who work for the user (staff and freelancers) and how each is paid. Call before logging work or paying, to use the right names.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }, (async (s) => ({ team: (await listStaff(s.db, s.org.id)).map((p) => staffSummary(s, p)) })));

  server.registerTool("save_staff", {
    title: "Add or change a team member",
    description:
      "Adds a person (no staff_id) or changes one (staff_id from list_staff). Pay modes: monthly (monthly_amount; optional weekly base of "
      + "visits or hours with an extra_rate for work beyond it), hourly (hourly_rate) or per_job (job_rate). Ask for anything unclear "
      + "(how they are paid, the amount); repeat the settings back after saving.",
    inputSchema: z.object({
      staff_id: UUID.optional(),
      name: z.string().min(1).max(80),
      role: z.string().max(80).optional().describe("Housekeeper, manager, gardener, pool…"),
      type: z.enum(["employee", "freelance"]).optional(),
      villa: z.string().optional(),
      pay_mode: z.enum(["monthly", "hourly", "per_job"]),
      monthly_amount: z.number().min(0).optional(),
      hourly_rate: z.number().positive().optional(),
      job_rate: z.number().positive().optional(),
      base_unit: z.enum(["visits", "hours"]).optional().describe("Monthly only: what the weekly base counts."),
      base_per_week: z.number().positive().optional(),
      extra_rate: z.number().min(0).optional().describe("Monthly only: pay per visit/hour beyond the base (default: monthly amount ÷ base of the month)."),
      currency: CURRENCY.optional(),
      payday: z.number().int().min(1).max(28).optional().describe("Day of the month they are paid (default 25)."),
      active: z.boolean().optional(),
      notes: z.string().max(500).optional(),
    }),
  }, (async (s, a: {
    staff_id?: string; name: string; role?: string; type?: "employee" | "freelance"; villa?: string; pay_mode: Staff["pay_mode"];
    monthly_amount?: number; hourly_rate?: number; job_rate?: number; base_unit?: "visits" | "hours"; base_per_week?: number;
    extra_rate?: number; currency?: string; payday?: number; active?: boolean; notes?: string;
  }) => {
    requireEditor(s);
    const villa = a.villa ? resolveVilla(s, a.villa) : s.villas.length === 1 ? s.villas[0] : null;
    const input: StaffInput = {
      name: a.name, role: a.role, kind: a.type, villa_id: villa?.id ?? null, pay_mode: a.pay_mode,
      currency: a.currency ?? villa?.currency ?? s.org.reportingCurrency, monthly_amount: a.monthly_amount, hourly_rate: a.hourly_rate,
      job_rate: a.job_rate, base_unit: a.base_unit, base_per_week: a.base_per_week, extra_rate: a.extra_rate, payday: a.payday,
      active: a.active, notes: a.notes,
    };
    const saved = a.staff_id ? await updateStaff(s.db, s.org.id, a.staff_id, input) : await createStaff(s.db, s.org.id, input);
    return { status: a.staff_id ? "updated" : "added", person: staffSummary(s, saved), link: `${APP}/team` };
  }));

  server.registerTool("log_work", {
    title: "Log work done",
    description:
      "Records that someone worked: \"Delia did the cleaning today\", \"Kadek 3h garden yesterday\", \"extra 150k for Alit on Saturday\". "
      + "Give hours for people paid by the hour (or with an hourly base), otherwise a number of visits/jobs (default 1). An agreed extra "
      + "goes in extra_amount. Resolve relative dates from today. Repeat what was logged.",
    inputSchema: z.object({
      person: z.string().describe("Name as in list_staff."),
      date: DATE.optional().describe("Defaults to today."),
      hours: z.number().positive().max(24).optional(),
      jobs: z.number().int().positive().optional(),
      extra_amount: z.number().positive().optional(),
      task: z.string().max(200).optional(),
      villa: z.string().optional(),
    }),
  }, (async (s, a: { person: string; date?: string; hours?: number; jobs?: number; extra_amount?: number; task?: string; villa?: string }) => {
    requireEditor(s);
    const p = await resolveStaff(s, a.person);
    const villa = a.villa ? resolveVilla(s, a.villa) : null;
    const log = await logWork(s.db, s.org.id, { staff_id: p.id, date: a.date ?? today(s), villa_id: villa?.id, hours: a.hours, jobs: a.jobs, extra_amount: a.extra_amount, task: a.task });
    return { status: "logged", person: p.name, date: log.date, hours: log.hours, jobs: log.jobs, extra_amount: log.extra_amount, task: log.task };
  }));

  server.registerTool("team_month", {
    title: "Who worked, and pay so far",
    description: "For a month (default: this one): each person's days worked, work done and the pay it comes to, with the status of their pay (not prepared, draft, paid).",
    inputSchema: z.object({ month: MONTH.optional() }),
    annotations: { readOnlyHint: true },
  }, (async (s, a: { month?: string }) => {
    const month = a.month ?? today(s).slice(0, 7);
    const lines = await payroll(s.db, s.org.id, month);
    return {
      month: monthLabel(month),
      people: lines.map((l) => ({
        name: l.staff.name, days_worked: l.computed.days_worked, how: describePay(l.computed), amount: l.computed.total, currency: l.staff.currency,
        pay_status: l.run?.status ?? "not prepared", paid_on: l.run?.paid_on ?? null,
      })),
      total: lines.reduce((n, l) => n + l.computed.total, 0),
      link: `${APP}/team?month=${month}`,
    };
  }));

  server.registerTool("prepare_payroll", {
    title: "Prepare the month's pay",
    description: "Computes each person's pay for the month (default: this one) from their settings and the work logged, and saves it as drafts. Paid ones are left alone. Show the list and the total, then offer to mark each as paid once transferred.",
    inputSchema: z.object({ month: MONTH.optional() }),
  }, (async (s, a: { month?: string }) => {
    requireEditor(s);
    const month = a.month ?? today(s).slice(0, 7);
    const lines = await preparePayroll(s.db, s.org.id, month);
    return {
      month: monthLabel(month),
      pay: lines.map((l) => ({ name: l.staff.name, amount: l.run?.amount ?? l.computed.total, currency: l.staff.currency, how: describePay(l.computed), status: l.run?.status ?? "draft" })),
      total: lines.reduce((n, l) => n + (l.run?.amount ?? l.computed.total), 0),
      link: `${APP}/team?month=${month}`,
    };
  }));

  server.registerTool("mark_paid", {
    title: "Mark someone's pay as paid",
    description:
      "Once the user has paid someone (\"paid Kadek\", or a transfer screenshot): books the month's prepared pay as an expense on the "
      + "payment date and marks it paid. If the user sent the transfer proof, pass its attachment_id. Prepare the payroll first if needed.",
    inputSchema: z.object({
      person: z.string(),
      month: MONTH.optional().describe("Month of the pay (default: this one)."),
      paid_on: DATE.optional().describe("Payment date (default: today)."),
      ...file,
    }),
  }, (async (s, a: { person: string; month?: string; paid_on?: string; file_url?: string; file_base64?: string; mime_type?: string; attachment_id?: string }) => {
    requireEditor(s);
    const p = await resolveStaff(s, a.person);
    const month = a.month ?? today(s).slice(0, 7);
    let lines = await payroll(s.db, s.org.id, month);
    if (!lines.find((l) => l.staff.id === p.id)?.run) lines = await preparePayroll(s.db, s.org.id, month);
    const run = lines.find((l) => l.staff.id === p.id)?.run;
    if (!run) throw new ToolError(`No pay to book for ${p.name} in ${monthLabel(month)}.`);
    const paid = await markPaid(s.db, s.org.id, run.id, a.paid_on ?? today(s));
    let proof = "none";
    if (a.file_url || a.file_base64 || a.attachment_id) { await storeEvidence(s, a, paid.transactionId); proof = "attached"; }
    return {
      status: "paid", person: p.name, month: monthLabel(month), amount: paid.run.amount, currency: paid.run.currency, paid_on: paid.run.paid_on,
      how: describePay(paid.run.breakdown), proof, link: `${APP}/transactions/${paid.transactionId}`,
    };
  }));
}

/** Pay of this month that is due (someone's payday has come) and not yet paid. */
async function payrollDue(s: Session, day: string) {
  const month = day.slice(0, 7);
  const lines = (await payroll(s.db, s.org.id, month)).filter((l) => l.staff.active && l.run?.status !== "paid" && Number(day.slice(8, 10)) >= l.staff.payday);
  if (!lines.length) return null;
  return {
    month: monthLabel(month),
    overdue: lines.some((l) => Number(day.slice(8, 10)) >= l.staff.payday + 2),
    people: lines.map((l) => ({ name: l.staff.name, amount: l.run?.amount ?? l.computed.total, currency: l.staff.currency, how: describePay(l.computed), status: l.run ? "prepared" : "not prepared" })),
    total: lines.reduce((n, l) => n + (l.run?.amount ?? l.computed.total), 0),
    link: `${APP}/team?month=${month}`,
  };
}
