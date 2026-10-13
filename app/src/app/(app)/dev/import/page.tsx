// Development-only preview of the stays import with a synthetic Airbnb export.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/PageHeader";
import { StaysImport } from "@/components/stays/StaysImport";

export default function DevImport() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-8">
      <PageHeader title="Import stays" description="Dev preview with a synthetic Airbnb export." />
      <Suspense><Preview /></Suspense>
    </main>
  );
}

async function Preview() {
  const text = await readFile(path.join(process.cwd(), "public/dev-fixtures/airbnb-sample.csv"), "utf8").catch(() => "");
  return (
    <StaysImport
      villas={[{ id: "00000000-0000-0000-0000-000000000001", name: "Villa One", currency: "IDR" }]}
      reportingCurrency="IDR"
      initialFile={text ? { name: "airbnb-sample.csv", text } : undefined}
    />
  );
}
