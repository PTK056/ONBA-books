// Readable names for downloaded documents, e.g. "2026-09-05_Electricity-token_1000000-IDR.jpg".

const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "application/pdf": "pdf",
};

const slug = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

export function documentFileName(
  tx: { date: string; description: string | null; merchant: string | null; amount: number; currency: string },
  file: { path: string; mime: string },
  index?: number,
): string {
  const ext = EXT[file.mime] ?? file.path.split(".").pop() ?? "bin";
  const label = slug(tx.merchant || tx.description || "receipt") || "receipt";
  const amount = `${Math.round(tx.amount * 100) / 100}-${tx.currency}`;
  return `${tx.date}_${label}_${amount}${index ? `_${index}` : ""}.${ext}`;
}
