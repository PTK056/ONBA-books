"use client";

import { AlertTriangle, BedDouble, Check, ChevronDown, Copy, FileText, Landmark, Link2, Search, Undo2, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { acceptAllSure, addStatement, askSply, bookCharges, createFromLine, decide, findEntries, linkLine, linkStay, markPersonal, matchAgain, resetLine, type EntryCandidate, type Result } from "@/app/(app)/bank/actions";
import { isSure, oneChargePerStatement, proposalLabel, type ProposalView } from "@/lib/bank/accountant/render";
import { money } from "@/components/overview/format";
import { Highlight, MiniStat } from "@/components/shell/Highlight";
import type { BankLineRow, BankStatementRow, ExpectedPayout, UnpaidStay } from "@/lib/bank/data";
import { shortDate } from "@/lib/format/date";
import { createClient } from "@/lib/supabase/client";

const field = "h-9 rounded-lg border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-brand-600 dark:border-zinc-700 dark:bg-zinc-900";
const primary = "h-9 rounded-lg bg-brand-600 px-3 btn-label shadow-sm hover:bg-brand-700 disabled:opacity-50";
const secondary = "h-9 rounded-lg border border-zinc-300 px-3 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";
const main = "inline-flex h-8 items-center gap-1 rounded-md bg-brand-50 px-2.5 text-xs font-medium text-brand-800 ring-1 ring-brand-200 hover:bg-brand-100 disabled:opacity-50 dark:bg-brand-950 dark:text-brand-200 dark:ring-brand-800";
const small = "inline-flex h-8 items-center gap-1 rounded-md border border-zinc-300 px-2 text-xs hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

type Option = { id: string; name: string };
interface Props {
  organizationId: string;
  reportingCurrency: string;
  villas: Option[];
  categories: (Option & { kind: "income" | "expense" })[];
  statements: BankStatementRow[];
  lines: BankLineRow[];
  expected: ExpectedPayout[];
  unpaid: UnpaidStay[];
  /** Where bank fees and interest go, in words (from Settings). */
  chargesTo: string;
}

function useAction() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const go = (fn: () => Promise<Result>, after?: () => void) => start(async () => {
    setError(null);
    setMessage(null);
    const r = await fn();
    if (!r.ok) { setError(r.error); return; }
    if (r.message) setMessage(r.message);
    after?.();
    router.refresh();
  });
  return { error, message, pending, go };
}

export function BankView(props: Props) {
  const { statements, lines } = props;
  const todo = lines.filter((l) => l.status === "unmatched");
  const matched = lines.filter((l) => l.status === "matched");
  const personal = lines.filter((l) => l.status === "personal");

  return (
    <div className="flex flex-col gap-6">
      {lines.length > 0 && (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Highlight
            className="col-span-2" label="At the bank, not in your books" icon={<Landmark size={16} />}
            value={String(todo.length)} unit={todo.length === 1 ? "line" : "lines"}
            note={`${matched.length} matched · ${personal.length} personal`}
          />
          <MiniStat label="Statements" value={String(statements.length)} />
          <MiniStat label="Airbnb payouts on their way" value={String(props.expected.length + props.unpaid.length)} />
        </section>
      )}

      {lines.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">
              At the bank, not in your books <span className="text-zinc-400">· {todo.length}</span>
            </h2>
            {todo.length > 0 && (
              <span className="flex flex-wrap items-center gap-2">
                <SplyBar todo={todo} />
                <MatchAgain />
              </span>
            )}
          </div>
          {todo.length === 0
            ? <p className="card p-4 text-sm text-zinc-500">Nothing left: every line is in your books or marked personal.</p>
            : <div className="card divide-y divide-zinc-100 dark:divide-zinc-800">{todo.map((l) => <TodoLine key={l.id} line={l} {...props} />)}</div>}
        </section>
      )}

      <Payouts expected={props.expected} unpaid={props.unpaid} />

      <Statements organizationId={props.organizationId} statements={statements} chargesTo={props.chargesTo} />

      {matched.length > 0 && <Done title="In your books" lines={matched} />}
      {personal.length > 0 && <Done title="Personal, not in the books" lines={personal} />}
    </div>
  );
}

const PAYOUT_STATE: Record<ExpectedPayout["state"], { label: string; tone: string }> = {
  on_its_way: { label: "On its way", tone: "text-zinc-500" },
  no_statement_yet: { label: "Add a later statement to check", tone: "text-zinc-500" },
  late: { label: "Not at the bank", tone: "text-amber-700 dark:text-amber-400" },
};

/** Airbnb payouts read from e-mails that no bank line has brought yet, and booked stays with no payout at all. */
function Payouts({ expected, unpaid }: { expected: ExpectedPayout[]; unpaid: UnpaidStay[] }) {
  if (!expected.length && !unpaid.length) return null;
  // Folded like the done lists, unless one needs a look.
  const alert = unpaid.length > 0 || expected.some((p) => p.state === "late");
  return (
    <details className="group" open={alert}>
      <summary className="cursor-pointer text-lg font-semibold marker:text-zinc-400">
        Airbnb payouts on their way <span className="text-zinc-400">· {expected.length + unpaid.length}</span>
      </summary>
      <div className="card mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
        {expected.map((p) => {
          const s = PAYOUT_STATE[p.state];
          return (
            <div key={p.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-3 text-sm">
              <span className="font-medium">{p.guest ?? "Guest"}</span>
              <span className="font-mono text-xs text-zinc-500">{p.code}</span>
              <span className="tabular-nums">{money(p.received, p.currency)} {p.currency}</span>
              <span className="text-zinc-500">sent {shortDate(p.sentOn)}{p.arrivesBy ? `, due by ${shortDate(p.arrivesBy)}` : ""}</span>
              <span className={`ml-auto ${s.tone}`}>{s.label}</span>
            </div>
          );
        })}
        {unpaid.map((x) => (
          <div key={x.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-3 text-sm">
            <span className="font-medium">{x.guest ?? "Guest"}</span>
            <span className="font-mono text-xs text-zinc-500">{x.code}</span>
            <span className="text-zinc-500">arrived {shortDate(x.checkIn)}</span>
            <span className="ml-auto text-amber-700 dark:text-amber-400">No payout from Airbnb yet: canceled?</span>
          </div>
        ))}
      </div>
    </details>
  );
}

function MatchAgain() {
  const { error, message, pending, go } = useAction();
  return (
    <span className="flex items-center gap-2 text-sm">
      {(message || error) && <span className={error ? "text-red-600" : "text-zinc-500"}>{error ?? message}</span>}
      <button className={secondary} disabled={pending} onClick={() => go(matchAgain)} title="Look again for entries that match these lines">
        {pending ? "Matching…" : "Match again"}
      </button>
    </span>
  );
}

/** Sply Accountant: look at the lines with no proposal yet; accept every sure proposal at once. */
function SplyBar({ todo }: { todo: BankLineRow[] }) {
  const { error, message, pending, go } = useAction();
  const proposals = todo.map((l) => l.proposal).filter((p): p is ProposalView => !!p);
  const sure = oneChargePerStatement(proposals.filter(isSure)).length;
  const unproposed = todo.length - proposals.length;
  return (
    <span className="flex items-center gap-2 text-sm">
      {(message || error) && <span className={error ? "text-red-600" : "text-zinc-500"}>{error ?? message}</span>}
      {sure > 0 && (
        <button className={primary} disabled={pending} onClick={() => go(acceptAllSure)} title="Apply every proposal Sply is sure of">
          {pending ? "Applying…" : `OK all ${sure} sure`}
        </button>
      )}
      {unproposed > 0 && (
        <button className={secondary} disabled={pending} onClick={() => go(askSply)}
          title="Sply Accountant proposes what each line is; nothing is booked until you say OK">
          {pending ? "Sply is looking…" : `🧾 Ask Sply (${unproposed})`}
        </button>
      )}
    </span>
  );
}

/** Sply's proposal on a line: what it is and why, with OK and Decline (a question has no OK). */
function Proposal({ p }: { p: ProposalView }) {
  const { error, pending, go } = useAction();
  return (
    <div className="ml-20 flex flex-col gap-1.5 rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 max-sm:ml-0 dark:border-brand-800 dark:bg-brand-950/40">
      <p className="text-sm">
        <span className="font-medium">🧾 Sply{p.action === "ask" ? " asks" : ""}:</span> {proposalLabel(p)}
        {isSure(p) && <span className="ml-2 rounded bg-brand-600 px-1.5 py-0.5 text-[11px] font-medium text-white">sure</span>}
      </p>
      {p.amountDiffers && p.action !== "ask" && <p className="text-xs text-amber-700 dark:text-amber-400">The amount differs: OK links it anyway; nothing is booked for the gap.</p>}
      {p.action !== "ask" && <p className="text-xs text-zinc-500">{p.why}</p>}
      <div className="flex gap-2">
        {p.action !== "ask" && <button className={main} disabled={pending} onClick={() => go(() => decide(p.id, "accept"))}><Check size={13} /> OK</button>}
        <button className={small} disabled={pending} onClick={() => go(() => decide(p.id, "reject"))}>{p.action === "ask" ? "Dismiss" : "Decline"}</button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

const RECENT_STATEMENTS = 2;

/** The statements read so far, latest first, with the button to add one; older ones stay folded. */
function Statements({ organizationId, statements, chargesTo }: { organizationId: string; statements: BankStatementRow[]; chargesTo: string }) {
  const older = statements.slice(RECENT_STATEMENTS);
  return (
    <section className="card">
      <AddStatement organizationId={organizationId} count={statements.length} />
      {statements.slice(0, RECENT_STATEMENTS).map((s) => <StatementRow key={s.id} s={s} chargesTo={chargesTo} />)}
      {older.length > 0 && (
        <details className="border-t border-zinc-100 dark:border-zinc-800">
          <summary className="cursor-pointer px-4 py-3 text-sm text-zinc-500 marker:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">
            {older.length} earlier statement{older.length === 1 ? "" : "s"}
          </summary>
          {older.map((s) => <StatementRow key={s.id} s={s} chargesTo={chargesTo} />)}
        </details>
      )}
    </section>
  );
}

/** Upload straight to the private bank bucket, then have the server read it. */
function AddStatement({ organizationId, count }: { organizationId: string; count: number }) {
  const input = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"idle" | "uploading" | "reading">("idle");
  const { error, message, go } = useAction();

  async function pick(file: File | undefined) {
    if (!file) return;
    const csv = /\.csv$/i.test(file.name);
    if (!csv && file.type !== "application/pdf") { alert("Add a bank statement PDF, or a Wise export (CSV)."); return; }
    const mimeType = csv ? "text/csv" : "application/pdf";
    setStep("uploading");
    const path = `${organizationId}/${crypto.randomUUID()}.${csv ? "csv" : "pdf"}`;
    const { error: upErr } = await createClient().storage.from("bank").upload(path, file, { contentType: mimeType });
    if (upErr) { setStep("idle"); alert("The file could not be uploaded. Try again."); return; }
    setStep("reading");
    go(() => addStatement({ path, name: file.name, mimeType }), () => setStep("idle"));
  }
  const busy = step !== "idle" && !error && !message;

  return (
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <FileText size={20} className="hidden shrink-0 text-zinc-400 sm:block" />
      <div className="flex-1 text-sm">
        <p className="font-medium">Statements {count > 0 && <span className="font-normal text-zinc-400">· {count}</span>}</p>
        <p className="text-zinc-500">
          {busy && step === "reading" ? "Reading the statement… a PDF takes about 30 seconds."
            : "Your bank's monthly PDF (unlocked) or a Wise CSV. Lines already read are skipped."}
        </p>
        {error && <p className="mt-1 text-red-600">{error}</p>}
        {message && <p className="mt-1 text-brand-700 dark:text-brand-400">{message}</p>}
      </div>
      <input ref={input} type="file" accept="application/pdf,.csv,text/csv" className="hidden"
        onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
      <button className={primary} disabled={busy} onClick={() => input.current?.click()}>
        {busy ? (step === "uploading" ? "Uploading…" : "Reading…") : "Add a statement"}
      </button>
    </div>
  );
}

function StatementRow({ s, chargesTo }: { s: BankStatementRow; chargesTo: string }) {
  const { error, pending, go } = useAction();
  return (
    <div className="flex flex-col gap-2 border-t border-zinc-100 p-4 text-sm sm:flex-row sm:items-center dark:border-zinc-800">
      <div className="flex-1">
        <p className="font-medium">
          {s.account} · {s.periodStart && s.periodEnd ? `${shortDate(s.periodStart)} → ${shortDate(s.periodEnd)}` : "period unknown"}
        </p>
        <p className="flex items-center gap-1 text-zinc-500">
          {s.balanced === true && <><Check size={14} className="text-brand-600" /> Balances add up · </>}
          {s.balanced === false && <><AlertTriangle size={14} className="text-amber-600" /> Balances don&apos;t add up, check against the PDF · </>}
          {s.linesAdded} lines{s.linesSkipped ? `, ${s.linesSkipped} already known` : ""}
        </p>
        {/* The reading's notes matter when the balances don't add up; otherwise they stay folded. */}
        {s.notes && (s.balanced === false
          ? <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{s.notes}</p>
          : <details className="mt-1 text-xs text-zinc-500"><summary className="cursor-pointer">Reading notes</summary><p className="mt-1">{s.notes}</p></details>)}
        {error && <p className="mt-1 text-red-600">{error}</p>}
      </div>
      {s.charges > 0 && (
        <div className="flex flex-col items-end gap-1">
          <button className={secondary} disabled={pending} onClick={() => go(() => bookCharges(s.id))}>
            Book {s.charges} bank charge{s.charges === 1 ? "" : "s"}
          </button>
          <Link href="/settings" className="text-xs text-zinc-500 hover:underline">Fees and interest → {chargesTo}</Link>
        </div>
      )}
    </div>
  );
}

const monthName = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en", { month: "long", timeZone: "UTC" });

function Amount({ line }: { line: BankLineRow }) {
  return (
    <span className={`tabular-nums ${line.direction === "in" ? "text-brand-700 dark:text-brand-400" : ""}`}>
      {line.direction === "in" ? "+" : "−"}{money(line.amount, line.currency)} <span className="text-xs text-zinc-400">{line.currency}</span>
    </span>
  );
}

function TodoLine({ line, villas, categories, reportingCurrency }: { line: BankLineRow } & Props) {
  const [open, setOpen] = useState<"add" | "find" | null>(null);
  const [more, setMore] = useState(false);
  const { error, pending, go } = useAction();
  const kind = line.direction === "in" ? "income" : "expense";

  function submit(form: FormData) {
    const get = (k: string) => String(form.get(k) ?? "");
    go(() => createFromLine(line.id, {
      villaId: get("villa") || villas[0].id, categoryId: get("category") || null,
      description: get("description"), fxRate: Number(get("fx")) || null,
    }), () => setOpen(null));
  }

  const toggle = (what: "add" | "find") => setOpen((o) => (o === what ? null : what));
  // What the line most likely is, best guess first: only that one shows, the rest wait behind "More".
  const suggested: { key: string; title: string; run: () => void; label: React.ReactNode }[] = [
    ...line.suggestions.map((s) => ({
      key: s.id, title: "This line is that entry", run: () => go(() => linkLine(line.id, s.id)),
      label: <><Link2 size={13} /> {shortDate(s.date)} {s.category ?? ""} {s.description && `· ${s.description}`}</>,
    })),
    ...line.stays.map((x) => ({
      key: x.id, title: "This transfer pays this stay (deposit, balance or extension); its income is already in the books",
      run: () => go(() => linkStay(line.id, x.id)),
      label: <><BedDouble size={13} /> Pays the stay of {x.guest ?? x.platform}, {shortDate(x.checkIn)} → {shortDate(x.checkOut)}</>,
    })),
    ...(line.known ? [{
      key: "known", title: `Booked like the last ${line.known.uses > 1 ? `${line.known.uses} payments` : "payment"} to this payee`,
      run: () => go(() => createFromLine(line.id, {
        villaId: line.known!.villaId, categoryId: line.known!.categoryId, description: line.known!.description ?? "", fxRate: null,
      })),
      label: <><Copy size={13} /> Like last time: {[line.known.category, line.known.villa, line.known.description].filter(Boolean).join(" · ")}</>,
    }] : []),
    ...(line.template && !line.known ? [{
      key: "template", title: `Same villa, category and description as the entry of ${shortDate(line.template.fromDate)}`,
      run: () => go(() => createFromLine(line.id, {
        villaId: line.template!.villaId, categoryId: line.template!.categoryId, description: line.template!.description, fxRate: null,
      })),
      label: <><Copy size={13} /> Like {monthName(line.template.fromDate)}: {[line.template.category, line.template.description].filter(Boolean).join(" · ")}</>,
    }] : []),
  ];
  const suggestion = (x: (typeof suggested)[number], className: string) => (
    <button key={x.key} className={className} disabled={pending} onClick={x.run} title={x.title}>{x.label}</button>
  );

  return (
    <div className="flex flex-col gap-2 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="w-16 tabular-nums text-zinc-500">{shortDate(line.date)}</span>
        <span className="min-w-0 flex-1 truncate">{line.counterparty ?? line.description}</span>
        <Amount line={line} />
      </div>
      {line.counterparty && line.description !== line.counterparty && (
        <p className="truncate pl-20 text-xs text-zinc-500 max-sm:pl-0">{line.description}</p>
      )}
      {line.proposal && <Proposal p={line.proposal} />}
      <div className="flex flex-wrap gap-2 pl-20 max-sm:pl-0">
        {suggested[0] && suggestion(suggested[0], main)}
        {!suggested.length && <button className={main} disabled={pending} onClick={() => toggle("add")}>Add to the books</button>}
        {more && suggested.slice(1).map((x) => suggestion(x, small))}
        {more && (
          <>
            <button className={small} disabled={pending} onClick={() => toggle("find")}
              title="Already in the books with another amount or date: link this line to it instead of adding it twice">
              <Search size={13} /> Already in the books
            </button>
            {suggested.length > 0 && <button className={small} disabled={pending} onClick={() => toggle("add")}>Add to the books</button>}
            <button className={small} disabled={pending} onClick={() => go(() => markPersonal(line.id))}>
              <UserRound size={13} /> Personal
            </button>
          </>
        )}
        <button className={`${small} border-transparent text-zinc-500`} onClick={() => setMore((m) => !m)} aria-expanded={more}>
          {more ? "Less" : "More"} <ChevronDown size={13} className={more ? "rotate-180" : ""} />
        </button>
      </div>
      {open === "find" && <FindEntry line={line} />}
      {open === "add" && (
        <form action={submit} className="flex flex-wrap items-end gap-2 pl-20 max-sm:pl-0">
          {villas.length > 1 && (
            <select name="villa" required className={field} aria-label="Villa" defaultValue={line.known?.villaId ?? (villas.length === 2 ? villas[0].id : "")}>
              <option value="" disabled>Villa…</option>
              {villas.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          )}
          <select name="category" className={field} aria-label="Category" defaultValue={line.known?.categoryId ?? ""}>
            <option value="">Category…</option>
            {categories.filter((c) => c.kind === kind).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input name="description" className={`${field} min-w-48 flex-1`} placeholder="What was it?" defaultValue={line.known?.description ?? line.counterparty ?? ""} />
          {line.currency !== reportingCurrency && (
            <input name="fx" inputMode="decimal" required className={`${field} w-36`} placeholder={`1 ${line.currency} = ? ${reportingCurrency}`} />
          )}
          <button className={primary} disabled={pending}>Save</button>
        </form>
      )}
      {error && <p className="pl-20 text-red-600 max-sm:pl-0">{error}</p>}
    </div>
  );
}

/** Search the books for the entry this line pays, when no suggestion came up; the closest amounts first. */
function FindEntry({ line }: { line: BankLineRow }) {
  const [search, setSearch] = useState("");
  const [entries, setEntries] = useState<EntryCandidate[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const { error, pending, go } = useAction();

  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      const r = await findEntries(line.id, search);
      if (!live) return;
      if (r.ok) { setEntries(r.entries); setFailed(null); } else setFailed(r.error);
    }, search ? 300 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [line.id, search]);

  return (
    <div className="flex flex-col gap-2 pl-20 max-sm:pl-0">
      <input className={`${field} max-w-sm`} value={search} onChange={(e) => setSearch(e.target.value)} autoFocus
        placeholder="Search a description (optional)" aria-label="Search the books" />
      {entries === null && !failed && <p className="text-xs text-zinc-500">Looking…</p>}
      {entries?.length === 0 && <p className="text-xs text-zinc-500">No entry left to link from 3 months before to 1 month after this line.</p>}
      {entries && entries.length > 0 && (
        <ul className="flex flex-col divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {entries.map((e) => {
            const gap = e.inLineCurrency === null ? 0 : Math.round(e.inLineCurrency - line.amount);
            return (
              <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <span className="w-14 tabular-nums text-zinc-500">{shortDate(e.date)}</span>
                <span className="min-w-0 flex-1 truncate">
                  {[e.category, e.villa, e.description].filter(Boolean).join(" · ") || "No description"}
                </span>
                <span className="tabular-nums">
                  {money(e.amount, e.currency)} <span className="text-xs text-zinc-400">{e.currency}</span>
                  {gap !== 0 && <span className="ml-1 text-xs text-amber-700 dark:text-amber-400">({gap > 0 ? "+" : "−"}{money(Math.abs(gap), line.currency)})</span>}
                </span>
                <button className={small} disabled={pending} onClick={() => go(() => linkLine(line.id, e.id))}>
                  <Link2 size={13} /> This one
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {(failed || error) && <p className="text-red-600">{failed ?? error}</p>}
    </div>
  );
}

const REASONS: Record<string, string> = {
  owner_transfer: "owner transfer", owner_contribution: "owner contribution", private_expense: "private expense", internal_transfer: "between own accounts",
};

function Done({ title, lines }: { title: string; lines: BankLineRow[] }) {
  const { pending, go } = useAction();
  return (
    <details className="group">
      <summary className="cursor-pointer text-lg font-semibold marker:text-zinc-400">
        {title} <span className="text-zinc-400">· {lines.length}</span>
      </summary>
      <div className="card mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
        {lines.map((l) => (
          <div key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-sm">
            <span className="w-16 tabular-nums text-zinc-500">{shortDate(l.date)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">
                {l.counterparty ?? l.description}
                {l.linkedTo && <span className="text-zinc-500"> → {l.linkedTo}{l.matchedBy === "auto" ? " (auto)" : ""}</span>}
                {l.personalReason && <span className="text-zinc-500"> · {REASONS[l.personalReason] ?? l.personalReason}</span>}
              </span>
              {l.handledVia === "agent" && (
                <span className="block truncate text-xs text-zinc-500" title={l.note ?? undefined}>
                  By the assistant{l.note ? `: ${l.note}` : ""}
                </span>
              )}
            </span>
            <Amount line={l} />
            <button className={small} disabled={pending} onClick={() => go(() => resetLine(l.id))} title="Put back in the list">
              <Undo2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </details>
  );
}
