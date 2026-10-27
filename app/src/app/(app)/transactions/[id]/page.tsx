import { ArrowLeft, FileText, Lock } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { money } from "@/components/overview/format";
import { shortDate } from "@/lib/format/date";
import { AttachReceipt, DeleteEntry, ShareDownload } from "@/components/transactions/FileActions";
import { TxForm } from "@/components/transactions/TxForm";
import { places } from "@/lib/org";
import { getTransaction, needsReceipt } from "@/lib/transactions/data";

const SOURCES: Record<string, string> = { manual: "Added by hand", receipt: "From a receipt", stay: "Imported stay", adjustment: "Adjustment", module: "From a bank statement" };

export default function TransactionPage({ params, searchParams }: PageProps<"/transactions/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-8">
      <Suspense fallback={<div className="card h-96 animate-pulse" />}>
        <Content params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Content({ params, searchParams }: Pick<PageProps<"/transactions/[id]">, "params" | "searchParams">) {
  const { id } = await params;
  const { edit } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await getTransaction(id);
  if (!data) redirect("/transactions");
  const { org, tx, files, closed, categories } = data;
  const cur = org.reportingCurrency;
  const editor = org.role !== "owner_viewer";
  const editable = editor && !closed && (tx.source === "manual" || tx.source === "receipt" || tx.source === "module");

  return (
    <>
      <Link href="/transactions" className="inline-flex w-fit items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"><ArrowLeft size={15} /> Transactions</Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-zinc-500">{shortDate(tx.date)} · {tx.villa.name} · {SOURCES[tx.source]}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{tx.description ?? tx.merchant ?? "Entry"}</h1>
          {tx.merchant && tx.merchant !== tx.description && <p className="text-sm text-zinc-500">{tx.merchant}</p>}
        </div>
        <div className="text-right">
          <p className={`text-2xl font-semibold tabular-nums ${tx.direction === "in" ? "text-emerald-700 dark:text-emerald-400" : ""}`}>
            {tx.direction === "in" ? "+" : "−"}{money(tx.amount, tx.currency)} <span className="text-sm font-normal text-zinc-400">{tx.currency}</span>
          </p>
          {tx.currency !== cur && <p className="text-sm text-zinc-500 tabular-nums">{money(tx.amountReporting, cur)} {cur} at {tx.fxRate}</p>}
          <p className="mt-1 text-sm text-zinc-500">{tx.category?.name ?? "No category"}{tx.stayCode && ` · ${tx.stayCode}`}</p>
        </div>
      </div>

      {closed && (
        <p className="flex items-center gap-2 rounded-lg bg-zinc-100 px-4 py-2.5 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
          <Lock size={14} /> This month is closed: the entry can&apos;t change, but you can still attach its receipt.
        </p>
      )}

      <section className="card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Receipt{files.length > 1 ? "s" : ""}</h2>
          {editor && files.length > 0 && <AttachReceipt transactionId={tx.id} organizationId={org.id} label="Add another file" />}
        </div>
        {files.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
            <FileText size={22} className="text-zinc-400" />
            <p className="text-sm text-zinc-500">{needsReceipt(tx) ? "No receipt attached yet." : tx.source === "stay" ? "Imported from the platform's export; no receipt needed." : "No file attached."}</p>
            {editor && <AttachReceipt transactionId={tx.id} organizationId={org.id} />}
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {files.map((f) => (
              <div key={f.id} className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="truncate font-mono text-xs text-zinc-500">{f.name}</span>
                  {f.downloadUrl && (
                    <ShareDownload
                      evidenceId={f.id} name={f.name} mime={f.mime} downloadUrl={f.downloadUrl}
                      label={`${tx.description ?? tx.merchant ?? "Receipt"} – ${shortDate(tx.date)} – ${money(tx.amount, tx.currency)} ${tx.currency}`}
                    />
                  )}
                </div>
                {f.viewUrl && (f.mime === "application/pdf"
                  ? <iframe src={f.viewUrl} title={f.name} className="h-[70vh] w-full rounded-lg bg-zinc-100 dark:bg-zinc-900" />
                  // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL
                  : <a href={f.viewUrl} target="_blank" rel="noreferrer" className="block"><img src={f.viewUrl} alt={f.name} className="mx-auto max-h-[70vh] rounded-lg bg-zinc-100 object-contain dark:bg-zinc-900" /></a>)}
              </div>
            ))}
          </div>
        )}
      </section>

      {editable && (
        <section className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Details</h2>
            {edit !== "1" && <Link href={`/transactions/${tx.id}?edit=1`} className="text-sm text-zinc-600 hover:underline dark:text-zinc-300">Edit</Link>}
          </div>
          {edit === "1" ? (
            <TxForm
              mode="edit" id={tx.id} organizationId={org.id} reportingCurrency={cur} villas={places(org)} categories={categories}
              initial={{ direction: tx.direction, date: tx.date, amount: tx.amount, currency: tx.currency, fxRate: tx.fxRate, categoryId: tx.category?.id ?? null, villaId: tx.villa.id, description: tx.description ?? "" }}
            />
          ) : (
            <p className="text-sm text-zinc-500">Correct the date, amount, category or villa if needed.</p>
          )}
          {(tx.source === "manual" || tx.source === "module") && <div className="mt-4 border-t border-zinc-100 pt-4 dark:border-zinc-800"><DeleteEntry id={tx.id} /></div>}
        </section>
      )}
    </>
  );
}
