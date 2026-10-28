"use client";

import { AlertTriangle, BedDouble, Check, Copy, FileText, Link2, Search, Undo2, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { addStatement, bookCharges, createFromLine, findEntries, linkLine, linkStay, markPersonal, matchAgain, resetLine, type EntryCandidate, type Result } from "@/app/(app)/bank/actions";
import { money } from "@/components/overview/format";
import type { BankLineRow, BankStatementRow } from "@/lib/bank/data";
import { shortDate } from "@/lib/format/date";
import { createClient } from "@/lib/supabase/client";

const field = "h-9 rounded-lg border border-zinc-300 bg-white px-2.5 text-sm shadow-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-900";
const primary = "h-9 rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50";
const secondary = "h-9 rounded-lg border border-zinc-300 px-3 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";
const small = "inline-flex h-8 items-center gap-1 rounded-md border border-zinc-300 px-2 text-xs hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

type Option = { id: string; name: string };
interface Props {
  organizationId: string;
  reportingCurrency: string;
  villas: Option[];
  categories: (Option & { kind: "income" | "expense" })[];
  statements: BankStatementRow[];
  lines: BankLineRow[];
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
      <AddStatement organizationId={props.organizationId} />

      {statements.length > 0 && (
        <section className="card divide-y divide-zinc-100 dark:divide-zinc-800">
          {statements.map((s) => <StatementRow key={s.id} s={s} chargesTo={props.chargesTo} />)}
        </section>
      )}

      {lines.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">
              At the bank, not in your books <span className="text-zinc-400">· {todo.length}</span>
            </h2>
            {todo.length > 0 && <MatchAgain />}
          </div>
          {todo.length === 0
            ? <p className="card p-4 text-sm text-zinc-500">Nothing left: every line is in your books or marked personal.</p>
            : <div className="card divide-y divide-zinc-100 dark:divide-zinc-800">{todo.map((l) => <TodoLine key={l.id} line={l} {...props} />)}</div>}
        </section>
      )}

      {matched.length > 0 && <Done title="In your books" lines={matched} />}
      {personal.length > 0 && <Done title="Personal, not in the books" lines={personal} />}
    </div>
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

/** Upload straight to the private bank bucket, then have the server read it. */
function AddStatement({ organizationId }: { organizationId: string }) {
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
    <section className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <FileText size={20} className="hidden shrink-0 text-zinc-400 sm:block" />
      <div className="flex-1 text-sm">
        <p className="font-medium">Add a bank statement</p>
        <p className="text-zinc-500">
          {busy && step === "reading" ? "Reading the statement… a PDF takes about 30 seconds."
            : "A monthly PDF from your bank (unlocked), or a Wise export in CSV. Lines already added from another statement are skipped."}
        </p>
        {error && <p className="mt-1 text-red-600">{error}</p>}
        {message && <p className="mt-1 text-emerald-700 dark:text-emerald-400">{message}</p>}
      </div>
      <input ref={input} type="file" accept="application/pdf,.csv,text/csv" className="hidden"
        onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
      <button className={primary} disabled={busy} onClick={() => input.current?.click()}>
        {busy ? (step === "uploading" ? "Uploading…" : "Reading…") : "Choose a file"}
      </button>
    </section>
  );
}

function StatementRow({ s, chargesTo }: { s: BankStatementRow; chargesTo: string }) {
  const { error, pending, go } = useAction();
  return (
    <div className="flex flex-col gap-2 p-4 text-sm sm:flex-row sm:items-center">
      <div className="flex-1">
        <p className="font-medium">
          {s.account} · {s.periodStart && s.periodEnd ? `${shortDate(s.periodStart)} → ${shortDate(s.periodEnd)}` : "period unknown"}
        </p>
        <p className="flex items-center gap-1 text-zinc-500">
          {s.balanced === true && <><Check size={14} className="text-emerald-600" /> Balances add up · </>}
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
    <span className={`tabular-nums ${line.direction === "in" ? "text-emerald-700 dark:text-emerald-400" : ""}`}>
      {line.direction === "in" ? "+" : "−"}{money(line.amount, line.currency)} <span className="text-xs text-zinc-400">{line.currency}</span>
    </span>
  );
}

function TodoLine({ line, villas, categories, reportingCurrency }: { line: BankLineRow } & Props) {
  const [open, setOpen] = useState<"add" | "find" | null>(null);
  const { error, pending, go } = useAction();
  const kind = line.direction === "in" ? "income" : "expense";

  function submit(form: FormData) {
    const get = (k: string) => String(form.get(k) ?? "");
    go(() => createFromLine(line.id, {
      villaId: get("villa") || villas[0].id, categoryId: get("category") || null,
      description: get("description"), fxRate: Number(get("fx")) || null,
    }), () => setOpen(null));
  }

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
      <div className="flex flex-wrap gap-2 pl-20 max-sm:pl-0">
        {line.suggestions.map((s) => (
          <button key={s.id} className={small} disabled={pending} onClick={() => go(() => linkLine(line.id, s.id))}
            title="This line is that entry">
            <Link2 size={13} /> {shortDate(s.date)} {s.category ?? ""} {s.description && `· ${s.description}`}
          </button>
        ))}
        {line.stays.map((x) => (
          <button key={x.id} className={small} disabled={pending} onClick={() => go(() => linkStay(line.id, x.id))}
            title="This transfer pays this stay (deposit, balance or extension); its income is already in the books">
            <BedDouble size={13} /> Pays the stay of {x.guest ?? x.platform}, {shortDate(x.checkIn)} → {shortDate(x.checkOut)}
          </button>
        ))}
        {line.known && (
          <button className={small} disabled={pending}
            title={`Booked like the last ${line.known.uses > 1 ? `${line.known.uses} payments` : "payment"} to this payee`}
            onClick={() => go(() => createFromLine(line.id, {
              villaId: line.known!.villaId, categoryId: line.known!.categoryId, description: line.known!.description ?? "", fxRate: null,
            }))}>
            <Copy size={13} /> Like last time: {[line.known.category, line.known.villa, line.known.description].filter(Boolean).join(" · ")}
          </button>
        )}
        {line.template && !line.known && (
          <button className={small} disabled={pending} title={`Same villa, category and description as the entry of ${shortDate(line.template.fromDate)}`}
            onClick={() => go(() => createFromLine(line.id, {
              villaId: line.template!.villaId, categoryId: line.template!.categoryId, description: line.template!.description, fxRate: null,
            }))}>
            <Copy size={13} /> Like {monthName(line.template.fromDate)}: {[line.template.category, line.template.description].filter(Boolean).join(" · ")}
          </button>
        )}
        <button className={small} disabled={pending} onClick={() => setOpen((o) => (o === "find" ? null : "find"))}
          title="Already in the books with another amount or date: link this line to it instead of adding it twice">
          <Search size={13} /> Already in the books
        </button>
        <button className={small} disabled={pending} onClick={() => setOpen((o) => (o === "add" ? null : "add"))}>Add to the books</button>
        <button className={small} disabled={pending} onClick={() => go(() => markPersonal(line.id))}>
          <UserRound size={13} /> Personal
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
            <span className="min-w-0 flex-1 truncate">
              {l.counterparty ?? l.description}
              {l.linkedTo && <span className="text-zinc-500"> → {l.linkedTo}{l.matchedBy === "auto" ? " (auto)" : ""}</span>}
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
