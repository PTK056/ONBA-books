// The monthly statement as a PDF (A4). Rendered on the server with @react-pdf/renderer.

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { fractionDigits } from "@/components/review/amount";
import type { Statement, StatementLine } from "./data";

const C = {
  ink: "#18181b", muted: "#71717a", faint: "#a1a1aa", line: "#e4e4e7", band: "#f4f4f5",
  brand: "#059669", amber: "#b45309", amberBg: "#fffbeb",
};

const s = StyleSheet.create({
  page: { padding: 40, paddingBottom: 56, fontSize: 9, color: C.ink, fontFamily: "Helvetica" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 },
  brand: { flexDirection: "row", alignItems: "center", gap: 6 },
  logo: { width: 16, height: 16, borderRadius: 4, backgroundColor: C.brand },
  brandName: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  title: { fontSize: 18, fontFamily: "Helvetica-Bold", marginTop: 10 },
  sub: { color: C.muted, marginTop: 3 },
  meta: { alignItems: "flex-end", color: C.muted, gap: 2 },
  provisional: { backgroundColor: C.amberBg, color: C.amber, padding: 8, borderRadius: 4, marginBottom: 14 },
  cards: { flexDirection: "row", gap: 8, marginBottom: 8 },
  card: { flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 6, padding: 10 },
  cardLabel: { color: C.muted, fontSize: 8 },
  cardValue: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 4 },
  cardNote: { color: C.faint, fontSize: 7.5, marginTop: 3 },
  section: { marginTop: 18 },
  h2: { fontSize: 11, fontFamily: "Helvetica-Bold", marginBottom: 6 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: C.line, paddingVertical: 4 },
  th: { flexDirection: "row", backgroundColor: C.band, paddingVertical: 4, color: C.muted, fontSize: 8 },
  total: { flexDirection: "row", paddingVertical: 5, fontFamily: "Helvetica-Bold", borderTopWidth: 1, borderTopColor: C.ink },
  catHead: { flexDirection: "row", paddingTop: 7, paddingBottom: 3, fontFamily: "Helvetica-Bold" },
  right: { textAlign: "right" },
  small: { color: C.muted, fontSize: 7.5 },
  footer: { position: "absolute", bottom: 24, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", color: C.faint, fontSize: 7.5 },
});

function money(v: number, currency: string) {
  const d = fractionDigits(currency);
  return new Intl.NumberFormat("en", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
}
// Built-in PDF fonts (Helvetica) only cover WinAnsi: no "→" or "−", so plain "–" and "-" are
// used. Month names are written out here so every server prints the same text.
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const parts = (iso: string) => ({ y: +iso.slice(0, 4), m: +iso.slice(5, 7) - 1, d: +iso.slice(8, 10) });
const day = (iso: string) => { const { m, d } = parts(iso); return `${String(d).padStart(2, "0")} ${MONTHS[m].slice(0, 3)}`; };
const monthName = (iso: string) => { const { y, m } = parts(iso); return `${MONTHS[m]} ${y}`; };
const fullDate = (iso: string) => `${day(iso)} ${iso.slice(0, 4)}`;

/** Fixed-width cell helper: widths in % of the row. */
const cell = (w: string, extra: object = {}) => ({ width: w, paddingHorizontal: 4, ...extra });

export function StatementPdf({ st }: { st: Statement }) {
  const cur = st.org.reportingCurrency;
  const t = st.totals;
  const period = monthName(st.month);

  return (
    <Document title={`${st.villa.name} – ${period}`} author="ONBA Books" creator="ONBA Books">
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <View style={s.brand}><View style={s.logo} /><Text style={s.brandName}>{st.org.name}</Text></View>
            <Text style={s.title}>Monthly statement</Text>
            <Text style={s.sub}>{st.villa.name} · {period}</Text>
          </View>
          <View style={s.meta}>
            <Text>Amounts in {cur}</Text>
            <Text>Issued {fullDate(st.generatedAt.slice(0, 10))}</Text>
            <Text>{st.closed ? "Month closed" : "Month open"}</Text>
          </View>
        </View>

        {!st.closed && (
          <Text style={s.provisional}>
            Provisional – {period} is not closed yet. Figures can still change until it is.
          </Text>
        )}

        <View style={s.cards}>
          <Card label="Income" value={money(t.stayIncome + t.otherIncome, cur)} note={t.otherIncome ? `incl. ${money(t.otherIncome, cur)} other` : "from stays"} />
          <Card label="Platform fees" value={money(t.platformFees, cur)} note="host fees" />
          <Card label="Operating expenses" value={money(t.operating, cur)} note={st.missingReceipts ? `${st.missingReceipts} without a receipt` : "all backed by a receipt"} />
          <Card label="Net result" value={money(t.net, cur)} strong />
        </View>
        <View style={s.cards}>
          <Card label="Occupancy" value={`${Math.round(st.occupancy.rate * 100)}%`} note={`${st.occupancy.booked} of ${st.occupancy.available} nights`} />
          <Card label="Average nightly rate" value={st.occupancy.adr === null ? "-" : money(st.occupancy.adr, cur)} />
          <Card label="RevPAR" value={money(st.occupancy.revpar, cur)} note="income per available night" />
          <Card label="Stays" value={String(st.stays.length)} note="with nights this month" />
        </View>

        {/* Summary as an account */}
        <View style={s.section}>
          <Text style={s.h2}>Summary</Text>
          <SumRow k="Income from stays (gross)" v={money(t.stayIncome, cur)} />
          {t.otherIncome > 0 && <SumRow k="Other income" v={money(t.otherIncome, cur)} />}
          <SumRow k="Platform fees" v={`- ${money(t.platformFees, cur)}`} />
          <SumRow k="Operating expenses" v={`- ${money(t.operating, cur)}`} />
          <View style={s.total}><Text style={{ flex: 1 }}>Net result</Text><Text>{money(t.net, cur)}</Text></View>
        </View>

        {st.stays.length > 0 && (
          <View style={s.section}>
            <Text style={s.h2}>Stays</Text>
            <View style={s.th} fixed>
              <Text style={cell("18%")}>Booking</Text>
              <Text style={cell("22%")}>Dates</Text>
              <Text style={cell("12%", s.right)}>Nights</Text>
              <Text style={cell("16%", s.right)}>Gross</Text>
              <Text style={cell("16%", s.right)}>Fees</Text>
              <Text style={cell("16%", s.right)}>Net</Text>
            </View>
            {st.stays.map((x) => (
              <View key={x.code} style={s.tr} wrap={false}>
                <View style={cell("18%")}>
                  <Text>{x.code}</Text>
                  <Text style={s.small}>{[x.platform === "airbnb" ? "Airbnb" : x.platform, x.guest].filter(Boolean).join(" · ")}</Text>
                </View>
                <Text style={cell("22%")}>{day(x.checkIn)} – {day(x.checkOut)}</Text>
                <Text style={cell("12%", s.right)}>{x.nightsInMonth}{x.nightsInMonth !== x.nightsTotal ? ` of ${x.nightsTotal}` : ""}</Text>
                <Text style={cell("16%", s.right)}>{money(x.gross, cur)}</Text>
                <Text style={cell("16%", s.right)}>{money(x.fees, cur)}</Text>
                <Text style={cell("16%", s.right)}>{money(x.net, cur)}</Text>
              </View>
            ))}
            <View style={s.total}>
              <Text style={cell("52%")}>Total stays</Text>
              <Text style={cell("16%", s.right)}>{money(t.stayIncome, cur)}</Text>
              <Text style={cell("16%", s.right)}>{money(t.platformFees, cur)}</Text>
              <Text style={cell("16%", s.right)}>{money(t.stayIncome - t.platformFees, cur)}</Text>
            </View>
            <Text style={[s.small, { marginTop: 4 }]}>Income and fees of stays spanning two months are split by nights.</Text>
          </View>
        )}

        {st.otherIncome.length > 0 && (
          <View style={s.section}>
            <Text style={s.h2}>Other income</Text>
            <Lines lines={st.otherIncome} cur={cur} />
          </View>
        )}

        <View style={s.section}>
          <Text style={s.h2}>Operating expenses</Text>
          {st.expenses.length === 0 ? <Text style={s.small}>No operating expenses this month.</Text> : (
            <>
              <View style={s.th} fixed>
                <Text style={cell("14%")}>Date</Text>
                <Text style={cell("52%")}>Description</Text>
                <Text style={cell("20%", s.right)}>Amount</Text>
                <Text style={cell("14%", s.right)}>Receipt</Text>
              </View>
              {st.expenses.map((g) => (
                <View key={g.category}>
                  <View style={s.catHead} wrap={false} minPresenceAhead={30}>
                    <Text style={cell("66%")}>{g.category}</Text>
                    <Text style={cell("20%", s.right)}>{money(g.total, cur)}</Text>
                    <Text style={cell("14%")} />
                  </View>
                  <Lines lines={g.lines} cur={cur} receipts />
                </View>
              ))}
              <View style={s.total}>
                <Text style={cell("66%")}>Total operating expenses</Text>
                <Text style={cell("20%", s.right)}>{money(t.operating, cur)}</Text>
                <Text style={cell("14%")} />
              </View>
            </>
          )}
        </View>

        <View style={s.footer} fixed>
          <Text>{st.villa.name} · {period} · generated by ONBA Books</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

function Card({ label, value, note, strong }: { label: string; value: string; note?: string; strong?: boolean }) {
  return (
    <View style={[s.card, strong ? { borderColor: C.brand } : {}]}>
      <Text style={s.cardLabel}>{label}</Text>
      <Text style={[s.cardValue, strong ? { color: C.brand } : {}]}>{value}</Text>
      {note && <Text style={s.cardNote}>{note}</Text>}
    </View>
  );
}

function SumRow({ k, v }: { k: string; v: string }) {
  return <View style={s.tr}><Text style={{ flex: 1 }}>{k}</Text><Text>{v}</Text></View>;
}

function Lines({ lines, cur, receipts = false }: { lines: StatementLine[]; cur: string; receipts?: boolean }) {
  return (
    <>
      {lines.map((l, i) => (
        <View key={i} style={s.tr} wrap={false}>
          <Text style={cell("14%")}>{day(l.date)}</Text>
          <View style={cell(receipts ? "52%" : "66%")}>
            <Text>{l.description ?? "-"}</Text>
            {l.merchant && <Text style={s.small}>{l.merchant}</Text>}
          </View>
          <View style={cell("20%")}>
            <Text style={s.right}>{money(l.amount, cur)}</Text>
            {l.original && <Text style={[s.small, s.right]}>{money(l.original.amount, l.original.currency)} {l.original.currency}</Text>}
          </View>
          {receipts && <Text style={cell("14%", { textAlign: "right", color: l.hasReceipt ? C.brand : C.amber })}>{l.hasReceipt ? "Attached" : "Missing"}</Text>}
        </View>
      ))}
    </>
  );
}
