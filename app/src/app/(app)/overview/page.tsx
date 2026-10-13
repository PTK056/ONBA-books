import { redirect } from "next/navigation";
import { Suspense } from "react";
import { OverviewView } from "@/components/overview/OverviewView";
import { loadOverview } from "@/lib/overview/data";

export default function OverviewPage({ searchParams }: PageProps<"/overview">) {
  return (
    <main className="flex flex-1 flex-col">
      <Suspense fallback={<OverviewSkeleton />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Content({ searchParams }: Pick<PageProps<"/overview">, "searchParams">) {
  const { month } = await searchParams;
  const result = await loadOverview(typeof month === "string" ? month : undefined);
  if (result.kind === "signed_out") redirect("/login?next=/overview");
  if (result.kind === "no_organization") redirect("/setup");
  return <OverviewView data={result.data} />;
}

function OverviewSkeleton() {
  return (
    <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-4 px-4 py-8 sm:grid-cols-2 sm:px-8 lg:grid-cols-4">
      {[0, 1, 2, 3].map((i) => <div key={i} className="card h-32 animate-pulse" />)}
      <div className="card h-72 animate-pulse sm:col-span-2 lg:col-span-4" />
    </div>
  );
}
