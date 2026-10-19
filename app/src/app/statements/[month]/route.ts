import { type NextRequest } from "next/server";
import { loadStatement } from "@/lib/statement/data";
import { renderStatement } from "@/lib/statement/render";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /statements/2026-09?villa=<id> → the monthly statement PDF (RLS decides who may read it). */
export async function GET(request: NextRequest, ctx: RouteContext<"/statements/[month]">) {
  const { month } = await ctx.params;
  const villa = request.nextUrl.searchParams.get("villa") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !UUID.test(villa)) {
    return new Response("Unknown month or villa", { status: 400 });
  }
  const st = await loadStatement(villa, `${month}-01`);
  if (!st) return new Response("Statement not found", { status: 404 });

  const pdf = await renderStatement(st);
  const name = `${st.villa.name.replace(/[^\w-]+/g, "-")}-${month}${st.closed ? "" : "-provisional"}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
