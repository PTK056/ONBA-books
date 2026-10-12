// Replays every Supabase table query found in the code against the real API, read-only.
//
// For each `.from("table")` chain it builds a GET with the same select (embeds included),
// the filtered and ordered columns, and the columns written by insert/update. Signed out,
// RLS returns no rows, but a wrong table, column or relationship is still an error: the
// kind of mistake the SQL tests cannot see because it lives in the app's query strings.
//
// npm run check:queries            (uses .env.local)
// node scripts/check-queries.mts <files...>   to check specific files

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOTS = ["src", "supabase/functions"];
const FILTERS = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in", "not", "contains"]);
const WRITES = new Set(["insert", "update", "upsert"]);

interface Check { file: string; line: number; table: string; params: URLSearchParams }

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx|mts)$/.test(name) && !/_test\.ts$|\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

const literal = (n: ts.Node | undefined) =>
  n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : undefined;

function checksIn(file: string): Check[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const out: Check[] = [];

  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "from" && literal(node.arguments[0]) &&
      !node.expression.expression.getText(source).endsWith("storage") // storage.from("bucket")
    ) {
      const table = literal(node.arguments[0])!;
      const selects: string[] = [];
      const columns = new Set<string>();
      const written = new Set<string>();
      const order: string[] = [];

      // Walk up the chain: from(...).select(...).eq(...)...
      let call: ts.Node = node;
      while (ts.isPropertyAccessExpression(call.parent) && ts.isCallExpression(call.parent.parent)) {
        const method = call.parent.name.text;
        const args = call.parent.parent.arguments;
        if (method === "select" && literal(args[0]) !== undefined) selects.push(literal(args[0])!);
        else if (FILTERS.has(method) && literal(args[0])) columns.add(literal(args[0])!);
        else if (method === "order" && literal(args[0])) order.push(literal(args[0])!);
        else if (WRITES.has(method) && args[0] && ts.isObjectLiteralExpression(args[0])) {
          for (const p of args[0].properties) {
            if (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) written.add(p.name.text);
          }
        }
        call = call.parent.parent;
      }

      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      const base = { file, line, table };
      for (const select of selects.length ? selects : ["*"]) {
        const params = new URLSearchParams({ select: select.replace(/\s+/g, ""), limit: "0" });
        for (const c of columns) params.append(c, "is.null");
        if (order.length) params.set("order", order.join(","));
        out.push({ ...base, params });
      }
      if (written.size) out.push({ ...base, params: new URLSearchParams({ select: [...written].join(","), limit: "0" }) });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see .env.example).");
  process.exit(2);
}

const targets = process.argv.slice(2).length ? process.argv.slice(2) : ROOTS.flatMap(files);
const checks = targets.flatMap(checksIn);
let failed = 0;
for (const c of checks) {
  const res = await fetch(`${url}/rest/v1/${c.table}?${c.params}`, { headers: { apikey: key } });
  if (res.ok) continue;
  failed++;
  const body = await res.json().catch(() => ({}));
  console.error(`✗ ${path.relative(process.cwd(), c.file)}:${c.line}  ${c.table}?${decodeURIComponent(c.params.toString())}`);
  console.error(`  ${res.status} ${body.code ?? ""} ${body.message ?? ""}${body.hint ? ` — ${body.hint}` : ""}`);
}
console.log(`${checks.length - failed}/${checks.length} queries OK across ${targets.length} files`);
process.exit(failed ? 1 : 0);
