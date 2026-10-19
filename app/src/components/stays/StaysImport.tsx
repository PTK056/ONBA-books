"use client";

import { AlertTriangle, CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { importAirbnb, type ImportSummary } from "@/app/(app)/import/actions";
import { money } from "@/components/overview/format";
import { shortDate } from "@/lib/format/date";
import { allocateByNights, parseAirbnbCsv, type AirbnbStay } from "@/lib/stays/airbnb";

interface Props {
  villas: { id: string; name: string; currency: string }[];
  reportingCurrency: string;
  /** Dev preview only: start with this file loaded. */
  initialFile?: { name: string; text: string };
}

const PREVIEW_ROWS = 15;

export function StaysImport({ villas, reportingCurrency, initialFile }: Props) {
  const [file, setFile] = useState<{ name: string; text: string } | null>(initialFile ?? null);
  const [villaFor, setVillaFor] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);
  const [result, setResult] = useState<ImportSummary | { error: string } | null>(null);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => (file ? parseAirbnbCsv(file.text) : null), [file]);
  const listings = parsed?.listings ?? [];
  const mapping = Object.fromEntries(listings.map((l) => [l, villaFor[l] ?? (villas.length === 1 ? villas[0].id : "")]));
  const ready = parsed && parsed.stays.length > 0 && listings.every((l) => mapping[l]);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setResult(null);
    setFile({ name: f.name, text: await f.text() });
  };

  if (result && !("error" in result)) {
    return <Done summary={result} onAgain={() => { setFile(null); setResult(null); }} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}
        className="card flex flex-col items-center gap-3 p-8 text-center"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950"><FileSpreadsheet size={20} /></span>
        {file ? (
          <p className="text-sm"><span className="font-medium">{file.name}</span> <button onClick={() => input.current?.click()} className="ml-2 text-zinc-500 underline-offset-2 hover:underline">Choose another file</button></p>
        ) : (
          <>
            <p className="text-sm font-medium">Drop your Airbnb transaction history (CSV)</p>
            <p className="max-w-md text-xs text-zinc-500">On Airbnb: Menu → Earnings → Transaction history → Download CSV. Importing the same file twice changes nothing.</p>
            <button onClick={() => input.current?.click()} className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
              <Upload size={15} /> Choose file
            </button>
          </>
        )}
        <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
      </div>

      {parsed && (
        <>
          {parsed.warnings.length > 0 && (
            <div className="card border-l-4 border-amber-400 p-4 text-sm">
              <p className="flex items-center gap-1.5 font-medium text-amber-800 dark:text-amber-200"><AlertTriangle size={15} /> To know before importing</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-zinc-600 dark:text-zinc-300">
                {parsed.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            </div>
          )}

          {parsed.stays.length > 0 && (
            <>
              <Totals stays={parsed.stays} />

              <section className="card p-5">
                <h2 className="mb-3 text-sm font-semibold">Which villa is each listing?</h2>
                <div className="flex flex-col gap-3">
                  {listings.map((l) => (
                    <label key={l} className="grid grid-cols-1 items-center gap-2 text-sm sm:grid-cols-[1fr_240px]">
                      <span className="truncate text-zinc-600 dark:text-zinc-300" title={l}>{l}</span>
                      <select
                        value={mapping[l]} onChange={(e) => setVillaFor((m) => ({ ...m, [l]: e.target.value }))}
                        className="h-9 rounded-lg border border-zinc-300 bg-white px-2 dark:border-zinc-700 dark:bg-zinc-900"
                      >
                        <option value="">Don&apos;t import</option>
                        {villas.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              </section>

              <section className="card overflow-hidden">
                <div className="flex items-center justify-between px-5 pt-5">
                  <h2 className="text-sm font-semibold">{parsed.stays.length} stays</h2>
                  <span className="text-xs text-zinc-500">Income and fees are booked in the month of each night</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="mt-3 w-full text-sm">
                    <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900">
                      <tr>
                        <th className="px-5 py-2 font-normal">Booking</th>
                        <th className="px-3 py-2 font-normal">Dates</th>
                        <th className="px-3 py-2 text-right font-normal">Gross</th>
                        <th className="px-3 py-2 text-right font-normal">Airbnb fee</th>
                        <th className="px-3 py-2 text-right font-normal">Net</th>
                        <th className="px-5 py-2 font-normal">Booked in</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...parsed.stays].reverse().slice(0, showAll ? undefined : PREVIEW_ROWS).map((s) => (
                        <tr key={s.code} className="border-t border-zinc-100 dark:border-zinc-800">
                          <td className="px-5 py-2">
                            <span className="font-mono text-xs">{s.code}</span>
                            {s.guest && <span className="block text-xs text-zinc-500">{s.guest.split(" ")[0]}</span>}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-zinc-600 dark:text-zinc-300">{shortDate(s.checkIn)} → {shortDate(s.checkOut)} <span className="text-zinc-400">· {s.nights}n</span></td>
                          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(s.gross, s.currency)} <span className="text-xs text-zinc-400">{s.currency}</span></td>
                          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-zinc-500">{money(s.fees, s.currency)}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">{money(s.net, s.currency)}</td>
                          <td className="px-5 py-2"><Months stay={s} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {parsed.stays.length > PREVIEW_ROWS && (
                  <button onClick={() => setShowAll((v) => !v)} className="w-full border-t border-zinc-100 py-2.5 text-xs text-zinc-500 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900">
                    {showAll ? "Show fewer" : `Show all ${parsed.stays.length} stays`}
                  </button>
                )}
              </section>

              {result && "error" in result && <p role="alert" className="text-sm text-red-600">{result.error}</p>}
              <div className="flex items-center justify-end gap-3">
                <span className="text-xs text-zinc-500">Converted to {reportingCurrency} at the rate Airbnb applied on each payout.</span>
                <button
                  disabled={!ready || pending}
                  onClick={() => start(async () => setResult(await importAirbnb(file!.text, mapping)))}
                  className="inline-flex h-10 items-center rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                >
                  {pending ? "Importing…" : `Import ${parsed.stays.length} stays`}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Totals({ stays }: { stays: AirbnbStay[] }) {
  const byCurrency = new Map<string, { gross: number; fees: number; net: number }>();
  for (const s of stays) {
    const t = byCurrency.get(s.currency) ?? { gross: 0, fees: 0, net: 0 };
    t.gross += s.gross; t.fees += s.fees; t.net += s.net;
    byCurrency.set(s.currency, t);
  }
  const nights = stays.reduce((n, s) => n + s.nights, 0);
  const tiles: [string, string][] = [
    ["Stays", String(stays.length)],
    ["Nights", String(nights)],
    ["Period", `${shortDate(stays[0].checkIn)} – ${shortDate(stays.at(-1)!.checkOut)}`],
    ...[...byCurrency].map(([c, t]): [string, string] => [`Net ${c}`, money(t.net, c)]),
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map(([k, v]) => (
        <div key={k} className="card p-4">
          <p className="text-xs text-zinc-500">{k}</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{v}</p>
        </div>
      ))}
    </div>
  );
}

function Months({ stay }: { stay: AirbnbStay }) {
  const months = [...new Set(allocateByNights(stay, 1).map((l) => l.date.slice(0, 7)))];
  return (
    <span className="flex flex-wrap gap-1">
      {months.map((m) => (
        <span key={m} className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en", { month: "short", year: "2-digit", timeZone: "UTC" })}
        </span>
      ))}
    </span>
  );
}

function Done({ summary, onAgain }: { summary: ImportSummary; onAgain: () => void }) {
  const problems = [...summary.conflicts, ...summary.skipped];
  return (
    <div className="card flex flex-col gap-4 p-6">
      <p className="flex items-center gap-2 text-lg font-semibold"><CheckCircle2 className="text-emerald-600" size={22} /> Import finished</p>
      <div className="grid grid-cols-3 gap-3 text-sm">
        {([["New stays", summary.created], ["Updated", summary.updated], ["Already up to date", summary.unchanged]] as const).map(([k, v]) => (
          <div key={k} className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/50"><p className="text-xs text-zinc-500">{k}</p><p className="text-xl font-semibold tabular-nums">{v}</p></div>
        ))}
      </div>
      {problems.length > 0 && (
        <div className="text-sm">
          <p className="font-medium text-amber-800 dark:text-amber-200">Not imported ({problems.length})</p>
          <ul className="mt-1 space-y-0.5 text-zinc-600 dark:text-zinc-300">
            {problems.map((p) => <li key={p.code}><span className="font-mono text-xs">{p.code}</span> — {p.reason}</li>)}
          </ul>
        </div>
      )}
      <div className="flex gap-2">
        <Link href="/overview" className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700">See the overview</Link>
        <button onClick={onAgain} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">Import another file</button>
      </div>
    </div>
  );
}

