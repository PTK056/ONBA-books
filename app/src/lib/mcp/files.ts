import "server-only";
import { ToolError, type Session } from "./session";

const MAX_BYTES = 10 * 1024 * 1024;
const TYPES: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "application/pdf": "pdf",
};

export interface FileInput { file_url?: string; file_base64?: string; mime_type?: string; file_name?: string }

/** Photo or PDF given as an https link or base64, checked for type and size. */
export async function readFileInput(f: FileInput): Promise<{ bytes: Uint8Array; mimeType: string; extension: string }> {
  let bytes: Uint8Array;
  let mime = (f.mime_type ?? "").toLowerCase().split(";")[0].trim();

  if (f.file_base64) {
    const b64 = f.file_base64.replace(/^data:([^;]+);base64,/, (_, m: string) => { mime ||= m.toLowerCase(); return ""; });
    bytes = Uint8Array.from(Buffer.from(b64, "base64"));
  } else if (f.file_url) {
    const url = safeUrl(f.file_url);
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (!res?.ok) throw new ToolError("Could not download the file from that link. Send the file again.");
    safeUrl(res.url); // the redirect target must be acceptable too
    if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new ToolError("The file is over 10 MB.");
    bytes = new Uint8Array(await res.arrayBuffer());
    mime ||= (res.headers.get("content-type") ?? "").toLowerCase().split(";")[0].trim();
  } else {
    throw new ToolError("Give the file as file_url (https) or file_base64.");
  }

  if (!bytes.length) throw new ToolError("The file is empty.");
  if (bytes.length > MAX_BYTES) throw new ToolError("The file is over 10 MB.");
  mime = sniff(bytes) ?? mime;
  const extension = TYPES[mime];
  if (!extension) throw new ToolError(`Unsupported file type (${mime || "unknown"}). Send a photo (JPEG, PNG, WebP) or a PDF.`);
  return { bytes, mimeType: mime, extension };
}

/** Stores the file in the organization's private evidence folder and returns its evidence row id. */
export async function storeEvidence(s: Session, f: FileInput, transactionId: string | null = null) {
  const file = await readFileInput(f);
  const path = `${s.org.id}/${crypto.randomUUID()}.${file.extension}`;
  const up = await s.db.storage.from("evidence").upload(path, file.bytes, { contentType: file.mimeType });
  if (up.error) throw new ToolError("Could not store the file. Try again.");
  const { data, error } = await s.db.from("evidence")
    .insert({ organization_id: s.org.id, storage_path: path, mime_type: file.mimeType, transaction_id: transactionId })
    .select("id").single();
  if (error || !data) throw new ToolError("Could not save the file. Try again.");
  return { evidenceId: data.id as string, path, mimeType: file.mimeType };
}

function safeUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new ToolError("file_url is not a valid link."); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")
      || /^[\d.]+$/.test(host) || host.includes(":")) {
    throw new ToolError("file_url must be a public https link.");
  }
  return url;
}

/** Trust the bytes over the declared type. */
function sniff(b: Uint8Array): string | null {
  const hex = (n: number) => Array.from(b.slice(0, n), (x) => x.toString(16).padStart(2, "0")).join("");
  if (hex(3) === "ffd8ff") return "image/jpeg";
  if (hex(8) === "89504e470d0a1a0a") return "image/png";
  if (hex(4) === "47494638") return "image/gif";
  if (hex(4) === "25504446") return "application/pdf";
  if (hex(4) === "52494646" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}
