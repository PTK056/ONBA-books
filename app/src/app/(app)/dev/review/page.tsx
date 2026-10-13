// Development-only preview of the review screen with local fixtures, no Supabase needed.
// Fixtures live in public/dev-fixtures/ (git-ignored): review.json plus the files it names.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ReviewQueue } from "@/components/review/ReviewQueue";
import type { ReviewItem, ReviewOptions } from "@/lib/review/types";
import { fakeAccept, fakeReject } from "./actions";

export default function DevReviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <main className="flex h-[calc(100dvh-3.5rem)] flex-col bg-white lg:h-dvh dark:bg-zinc-950">
      <Suspense>
        <Preview />
      </Suspense>
    </main>
  );
}

async function Preview() {
  const file = path.join(process.cwd(), "public/dev-fixtures/review.json");
  const raw = await readFile(file, "utf8").catch(() => null);
  if (!raw) return <p className="p-6 text-sm">No fixtures: create public/dev-fixtures/review.json.</p>;
  const { items, options } = JSON.parse(raw) as { items: ReviewItem[]; options: ReviewOptions };
  return <ReviewQueue items={items} options={options} accept={fakeAccept} reject={fakeReject} />;
}
