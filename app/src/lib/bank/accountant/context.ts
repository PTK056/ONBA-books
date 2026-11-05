import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { entryCandidates, stayCandidates } from "../candidates";
import { payeeMemory } from "../data";
import type { Dossier } from "./propose";

// What Sply Accountant knows before asking Claude: the organization's names, and for each line a dossier built by
// code (usual booking of the payee, candidate entries and stays). Claude only chooses among what is in the dossier.

export interface AccountantOrg {
  id: string; name: string; reportingCurrency: string; evidenceThreshold: number;
  villas: { id: string; name: string }[];
  company: { id: string; name: string } | null;
  categories: { id: string; name: string; kind: "income" | "expense" }[];
}

export async function loadOrg(db: SupabaseClient, orgId: string): Promise<AccountantOrg> {
  const [{ data: org }, { data: places }, { data: cats }] = await Promise.all([
    db.from("organizations").select("id, name, reporting_currency, evidence_threshold").eq("id", orgId).single(),
    db.from("villas").select("id, name, kind").eq("organization_id", orgId).is("archived_at", null).order("name"),
    db.from("categories").select("id, name, kind").eq("organization_id", orgId).is("archived_at", null).order("name"),
  ]);
  if (!org) throw new Error("Organization not found");
  return {
    id: org.id, name: org.name, reportingCurrency: org.reporting_currency, evidenceThreshold: Number(org.evidence_threshold),
    villas: (places ?? []).filter((v) => v.kind === "villa").map((v) => ({ id: v.id, name: v.name })),
    company: (places ?? []).filter((v) => v.kind === "company").map((v) => ({ id: v.id, name: v.name }))[0] ?? null,
    categories: (cats ?? []) as AccountantOrg["categories"],
  };
}

export interface OpenLine {
  id: string; statement_id: string; account_id: string; date: string; direction: "in" | "out"; amount: number; currency: string;
  description: string; counterparty: string | null; reference: string | null; payee_last4: string | null;
}

export const OPEN_LINE_FIELDS = "id, statement_id, account_id, date, direction, amount, currency, description, counterparty, reference, payee_last4";

/** One dossier per line, refs L1, L2… and inside each line E1… (entries) and S1… (stays): short, and never a real id. */
export async function buildDossiers(db: SupabaseClient, org: AccountantOrg, lines: OpenLine[], accountNames: Map<string, string>): Promise<Dossier[]> {
  const known = await payeeMemory(db, org.id);
  const out: Dossier[] = [];
  // A few lines at a time: each needs three or four small queries.
  for (let i = 0; i < lines.length; i += 5) {
    const batch = await Promise.all(lines.slice(i, i + 5).map(async (l, j): Promise<Dossier> => {
      const line = { date: l.date, direction: l.direction, amount: Number(l.amount), currency: l.currency, counterparty: l.counterparty, description: l.description };
      const [entries, stays] = await Promise.all([
        entryCandidates(db, org.id, org.reportingCurrency, line, { windowDays: 10, tolerancePct: 3, limit: 5 }),
        stayCandidates(db, org.id, line),
      ]);
      const usual = known(l);
      return {
        ref: `L${i + j + 1}`, lineId: l.id, statementId: l.statement_id, ...line,
        account: accountNames.get(l.account_id) ?? null, reference: l.reference,
        usual: usual ? { villa: usual.villa, category: usual.category, description: usual.description, times: usual.uses } : null,
        entries: entries.map((e, k) => ({ ...e, ref: `E${k + 1}` })),
        stays: stays.slice(0, 5).map((x, k) => ({ ...x, ref: `S${k + 1}` })),
      };
    }));
    out.push(...batch);
  }
  return out;
}
