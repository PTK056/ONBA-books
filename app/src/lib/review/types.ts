// Shapes shared by the review screen, its server loader and its actions.

export const CHECKABLE_FIELDS = ["date", "total", "currency", "merchant", "category"] as const;
export type CheckableField = (typeof CHECKABLE_FIELDS)[number];

/** What the receipt engine stored in receipt_items.proposed (see functions/read-receipts). */
export interface Proposed {
  is_receipt?: boolean;
  document_type?: "receipt" | "invoice" | "transfer_slip" | "bank_statement" | "other";
  merchant?: string | null;
  date?: string | null;
  currency?: string | null;
  total?: number | null;
  printed_total?: number | null;
  description?: string;
  category_id?: string | null;
  villa_id?: string | null;
  uncertain_fields?: CheckableField[];
  confidence?: number;
  notes?: string | null;
  possible_duplicate_of?: string | null;
  /** Set instead of the fields above when the engine could not read the file. */
  error?: string;
}

export interface ReviewItem {
  id: string;
  fileUrl: string | null;
  mimeType: string;
  proposed: Proposed;
}

/** Uploaded receipts the engine has not read yet (e.g. after an outage). */
export interface UnreadSummary { count: number; batchIds: string[] }

export interface ReviewOptions {
  organizationName: string;
  reportingCurrency: string;
  categories: { id: string; name: string }[];
  villas: { id: string; name: string; currency: string }[];
  /** Last rate used per currency, to prefill conversions. */
  lastRates: Record<string, number>;
}

export interface AcceptInput {
  itemId: string;
  villaId: string;
  date: string;
  categoryId: string | null;
  currency: string;
  amount: number;
  fxRate: number;
  description: string;
}

export type ActionResult = { ok: true } | { ok: false; error: string };
