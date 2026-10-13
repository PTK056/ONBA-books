"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import type {
  AcceptInput,
  ActionResult,
  CheckableField,
  ReviewItem,
  ReviewOptions,
} from "@/lib/review/types";
import { formatAmount, parseAmount } from "./amount";

interface Props {
  items: ReviewItem[];
  options: ReviewOptions;
  accept: (input: AcceptInput) => Promise<ActionResult>;
  reject: (itemId: string) => Promise<ActionResult>;
}

/** One receipt at a time: the file on the left, the proposed entry on the right. */
export function ReviewQueue({ items: initial, options, accept, reject }: Props) {
  const [items, setItems] = useState(initial);
  const [index, setIndex] = useState(0);
  const [reviewed, setReviewed] = useState(0);

  // A server refresh brings a new queue (e.g. after another reviewer's work).
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setItems(initial);
    setIndex(Math.min(index, Math.max(0, initial.length - 1)));
  }

  const item = items[index];
  const done = (id: string) => {
    const next = items.filter((x) => x.id !== id);
    setReviewed((n) => n + 1);
    setItems(next);
    setIndex(Math.min(index, Math.max(0, next.length - 1)));
  };

  if (!item) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-lg font-medium">Nothing left to review</p>
        <p className="text-sm text-zinc-500">
          {reviewed ? `${reviewed} receipt${reviewed > 1 ? "s" : ""} reviewed in this session.` : "New receipts will appear here once they have been read."}
        </p>
        <Link href="/upload" className="mt-2 rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
          Add receipts
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <div className="text-sm">
          <span className="font-semibold">Receipts to review</span>
          <span className="text-zinc-500"> · {options.organizationName}</span>
        </div>
        <nav className="flex items-center gap-1 text-sm" aria-label="Queue">
          <button
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={index === 0}
            className="rounded px-2 py-1 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
            aria-label="Previous receipt"
          >
            ←
          </button>
          <span className="tabular-nums text-zinc-600 dark:text-zinc-400">
            {index + 1} of {items.length}
          </span>
          <button
            onClick={() => setIndex((i) => Math.min(items.length - 1, i + 1))}
            disabled={index === items.length - 1}
            className="rounded px-2 py-1 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
            aria-label="Next receipt"
          >
            →
          </button>
        </nav>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_420px] lg:overflow-hidden">
        <FileViewer key={`f-${item.id}`} item={item} />
        <EntryForm
          key={item.id}
          item={item}
          options={options}
          onAccept={async (input) => {
            const r = await accept(input);
            if (r.ok) done(item.id);
            return r;
          }}
          onReject={async () => {
            const r = await reject(item.id);
            if (r.ok) done(item.id);
            return r;
          }}
        />
      </div>
    </div>
  );
}

function FileViewer({ item }: { item: ReviewItem }) {
  const [zoom, setZoom] = useState(false);
  const [turn, setTurn] = useState(0);
  if (!item.fileUrl) {
    return <div className="flex items-center justify-center bg-zinc-100 p-8 text-sm text-zinc-500 dark:bg-zinc-900">File unavailable</div>;
  }
  if (item.mimeType === "application/pdf") {
    return <iframe src={item.fileUrl} title="Receipt" className="h-[60vh] w-full bg-zinc-100 lg:h-full dark:bg-zinc-900" />;
  }
  return (
    <div className="relative flex max-h-[50vh] items-start justify-center overflow-auto bg-zinc-100 p-4 lg:max-h-none lg:min-h-0 dark:bg-zinc-900">
      <div className="absolute right-3 top-3 z-10 flex gap-1">
        <ToolButton label="Rotate" onClick={() => setTurn((t) => (t + 90) % 360)}>⟳</ToolButton>
        <ToolButton label={zoom ? "Fit to screen" : "Zoom in"} onClick={() => setZoom((z) => !z)}>{zoom ? "−" : "+"}</ToolButton>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- signed Storage URL, no optimizer */}
      <img
        src={item.fileUrl}
        alt="Receipt"
        onClick={() => setZoom((z) => !z)}
        style={{ transform: `rotate(${turn}deg)` }}
        className={zoom ? "max-w-none cursor-zoom-out" : "max-h-[45vh] max-w-full cursor-zoom-in object-contain lg:max-h-[calc(100vh-8rem)]"}
      />
    </div>
  );
}

function ToolButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="h-8 w-8 rounded-md bg-white/90 text-base shadow-sm ring-1 ring-zinc-200 hover:bg-white dark:bg-zinc-800/90 dark:ring-zinc-700"
    >
      {children}
    </button>
  );
}

function EntryForm({
  item,
  options,
  onAccept,
  onReject,
}: {
  item: ReviewItem;
  options: ReviewOptions;
  onAccept: (input: AcceptInput) => Promise<ActionResult>;
  onReject: () => Promise<ActionResult>;
}) {
  const p = item.proposed;
  const unreadable = Boolean(p.error) || p.is_receipt === false;
  const check = new Set<CheckableField>(p.uncertain_fields ?? []);
  const defaultVilla = p.villa_id ?? (options.villas.length === 1 ? options.villas[0].id : "");

  const [date, setDate] = useState(p.date ?? "");
  const [currency, setCurrency] = useState(p.currency ?? options.villas.find((v) => v.id === defaultVilla)?.currency ?? "");
  const [amountText, setAmountText] = useState(p.total != null ? formatAmount(p.total, p.currency ?? "") : "");
  const [categoryId, setCategoryId] = useState(p.category_id ?? "");
  const [villaId, setVillaId] = useState(defaultVilla);
  const [description, setDescription] = useState(p.description ?? "");
  const [rateText, setRateText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const needsRate = currency.length === 3 && currency !== options.reportingCurrency;
  const amount = parseAmount(amountText, currency);
  const lastRate = options.lastRates[currency];
  const rate = needsRate ? (rateText ? parseAmount(rateText, "") : lastRate ?? null) : 1;
  const converted = amount != null && rate ? amount * rate : null;

  const submit = useCallback(() => {
    setError(null);
    if (!villaId) return setError("Choose a villa.");
    if (!date) return setError("Enter the date.");
    if (amount == null || amount <= 0) return setError("Enter the amount.");
    if (!/^[A-Z]{3}$/.test(currency)) return setError("Enter a three-letter currency code.");
    if (!rate) return setError(`Enter the ${currency} → ${options.reportingCurrency} rate.`);
    startTransition(async () => {
      const r = await onAccept({
        itemId: item.id, villaId, date, categoryId: categoryId || null,
        currency, amount, fxRate: rate, description,
      });
      if (!r.ok) setError(r.error);
    });
  }, [villaId, date, amount, currency, rate, categoryId, description, item.id, onAccept, options.reportingCurrency]);

  const discard = () => {
    setError(null);
    startTransition(async () => {
      const r = await onReject();
      if (!r.ok) setError(r.error);
    });
  };

  // ⌘/Ctrl + Enter accepts from anywhere in the form.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !unreadable && !pending) {
        e.preventDefault();
        submit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submit, unreadable, pending]);

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      className="flex min-h-0 flex-col gap-4 border-t lg:overflow-y-auto border-zinc-200 p-4 lg:border-l lg:border-t-0 dark:border-zinc-800"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="truncate text-base font-semibold">{p.merchant || (unreadable ? "File" : "Receipt")}</h2>
        {!unreadable && <ConfidenceBadge value={p.confidence} />}
      </div>

      {p.error && <Callout tone="red" title="Could not read this file">{p.error}</Callout>}
      {!p.error && p.is_receipt === false && (
        <Callout tone="red" title={p.document_type === "bank_statement" ? "This is a bank statement" : "This is not a receipt"}>
          {p.notes ?? "Nothing to book from this file."}
        </Callout>
      )}
      {!unreadable && p.notes && <Callout tone="amber" title="To check">{p.notes}</Callout>}
      {p.possible_duplicate_of && (
        <Callout tone="amber" title="Possible duplicate">
          A transaction with the same date, currency and amount is already in the books.
        </Callout>
      )}

      {!unreadable && (
        <>
          <Field label="Date" flagged={check.has("date")}>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input(check.has("date"))} />
          </Field>

          <div className="grid grid-cols-[1fr_96px] gap-3">
            <Field label="Amount" flagged={check.has("total")}>
              <input
                inputMode="decimal" value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                onBlur={() => amount != null && setAmountText(formatAmount(amount, currency))}
                className={`${input(check.has("total"))} text-right tabular-nums`}
              />
            </Field>
            <Field label="Currency" flagged={check.has("currency")}>
              <input
                value={currency} maxLength={3}
                onChange={(e) => setCurrency(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
                className={`${input(check.has("currency"))} uppercase`}
              />
            </Field>
          </div>
          {p.printed_total != null && p.printed_total !== amount && (
            <p className="-mt-2 text-xs text-zinc-600 dark:text-zinc-400">
              Printed total {formatAmount(p.printed_total, currency)} — the handwritten amount is used.{" "}
              <button type="button" className="underline" onClick={() => setAmountText(formatAmount(p.printed_total!, currency))}>
                Use printed total
              </button>
            </p>
          )}

          {needsRate && (
            <Field label={`Rate ${currency} → ${options.reportingCurrency}`}>
              <input
                inputMode="decimal" value={rateText}
                placeholder={lastRate ? `${lastRate} (last used)` : "e.g. 0.0000625"}
                onChange={(e) => setRateText(e.target.value)}
                className={`${input(false)} tabular-nums`}
              />
              {converted != null && (
                <span className="mt-1 block text-xs text-zinc-500 tabular-nums">
                  = {formatAmount(converted, options.reportingCurrency)} {options.reportingCurrency}
                </span>
              )}
            </Field>
          )}

          <Field label="Category" flagged={check.has("category")}>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={input(check.has("category"))}>
              <option value="">— No category —</option>
              {options.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>

          <Field label="Villa">
            <select value={villaId} onChange={(e) => setVillaId(e.target.value)} className={input(!villaId)}>
              {!villaId && <option value="">Choose a villa…</option>}
              {options.villas.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>

          <Field label="Description">
            <input value={description} onChange={(e) => setDescription(e.target.value)} className={input(false)} />
          </Field>
        </>
      )}

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <div className="sticky bottom-0 -mx-4 -mb-4 mt-auto flex gap-2 border-t border-zinc-200 bg-white/95 p-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
        {!unreadable && (
          <button
            type="submit" disabled={pending}
            className="flex-1 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {pending ? "Saving…" : "Accept"} <kbd className="ml-1 hidden text-xs opacity-70 lg:inline">⌘↵</kbd>
          </button>
        )}
        <button
          type="button" onClick={discard} disabled={pending}
          className={`rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50 ${
            unreadable
              ? "flex-1 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          }`}
        >
          {unreadable ? "Remove from queue" : "Reject"}
        </button>
      </div>
    </form>
  );
}

function Field({ label, flagged = false, children }: { label: string; flagged?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">
        {label}
        {flagged && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">Check</span>}
      </span>
      {children}
    </label>
  );
}

const input = (flagged: boolean) =>
  `w-full rounded-md border bg-white px-3 py-2 text-sm dark:bg-zinc-900 ${
    flagged ? "border-amber-400 ring-2 ring-amber-200 dark:ring-amber-900" : "border-zinc-300 dark:border-zinc-700"
  }`;

function Callout({ tone, title, children }: { tone: "amber" | "red"; title: string; children: React.ReactNode }) {
  const colors = tone === "red"
    ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100"
    : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100";
  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${colors}`}>
      <p className="font-medium">{title}</p>
      <p className="mt-0.5">{children}</p>
    </div>
  );
}

function ConfidenceBadge({ value }: { value?: number }) {
  const { label, cls } = useMemo(() => {
    if (value == null) return { label: "Unread", cls: "bg-zinc-100 text-zinc-600" };
    if (value >= 0.9) return { label: "Clear", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200" };
    if (value >= 0.6) return { label: "Check", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200" };
    return { label: "Doubtful", cls: "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200" };
  }, [value]);
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}

