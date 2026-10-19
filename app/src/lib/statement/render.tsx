import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import type { Statement } from "./data";
import { StatementPdf } from "./StatementPdf";

export function renderStatement(st: Statement): Promise<Buffer> {
  return renderToBuffer(<StatementPdf st={st} />);
}
