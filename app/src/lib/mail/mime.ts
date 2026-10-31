// Minimal RFC 822 / MIME reader for e-mails fetched raw (Gmail API format=raw, .eml files).
// Enough for platform notifications: folded headers, encoded words, multipart (nested),
// quoted-printable and base64 bodies, any charset TextDecoder knows.
//
// Self-contained (no app imports) so it can be tested with `node --test`.

export interface MailMessage {
  /** Header values by lower-case name, in the order they appear (topmost first). */
  headers: Map<string, string[]>;
  text: string | null;
  html: string | null;
}

export function header(m: MailMessage, name: string): string | null {
  return m.headers.get(name.toLowerCase())?.[0] ?? null;
}

export function parseMessage(raw: string | Uint8Array): MailMessage {
  const bytes = typeof raw === "string" ? new TextEncoder().encode(raw) : raw;
  const out: MailMessage = { headers: new Map(), text: null, html: null };
  const { headers, body } = splitPart(bytes);
  out.headers = headers;
  walk(headers, body, out);
  return out;
}

function splitPart(bytes: Uint8Array): { headers: Map<string, string[]>; body: Uint8Array } {
  // Headers end at the first empty line (CRLF CRLF or LF LF). Headers are ASCII / UTF-8.
  let end = -1, skip = 0;
  for (let i = 0; i < bytes.length - 1; i++) {
    if (bytes[i] === 10 && bytes[i + 1] === 10) { end = i; skip = 2; break; }
    if (bytes[i] === 10 && bytes[i + 1] === 13 && bytes[i + 2] === 10) { end = i; skip = 3; break; }
  }
  const head = new TextDecoder().decode(end < 0 ? bytes : bytes.subarray(0, end));
  const body = end < 0 ? new Uint8Array() : bytes.subarray(end + skip);
  const headers = new Map<string, string[]>();
  for (const line of head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    headers.set(name, [...(headers.get(name) ?? []), decodeWords(line.slice(colon + 1).trim())]);
  }
  return { headers, body };
}

function param(value: string, name: string): string | null {
  const m = new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, "i").exec(value);
  return m ? (m[1] ?? m[2]) : null;
}

function walk(headers: Map<string, string[]>, body: Uint8Array, out: MailMessage) {
  const type = headers.get("content-type")?.[0] ?? "text/plain";
  const mediaType = type.split(";")[0].trim().toLowerCase();
  if (mediaType.startsWith("multipart/")) {
    const boundary = param(type, "boundary");
    if (!boundary) return;
    for (const part of splitMultipart(body, boundary)) {
      const p = splitPart(part);
      walk(p.headers, p.body, out);
    }
    return;
  }
  if (mediaType !== "text/plain" && mediaType !== "text/html") return;
  if (/attachment/i.test(headers.get("content-disposition")?.[0] ?? "")) return;
  const encoding = (headers.get("content-transfer-encoding")?.[0] ?? "7bit").toLowerCase();
  const decoded = encoding === "quoted-printable" ? decodeQuotedPrintable(body)
    : encoding === "base64" ? decodeBase64(body) : body;
  const text = decodeCharset(decoded, param(type, "charset") ?? "utf-8");
  if (mediaType === "text/plain" && out.text === null) out.text = text;
  if (mediaType === "text/html" && out.html === null) out.html = text;
}

function splitMultipart(body: Uint8Array, boundary: string): Uint8Array[] {
  const s = latin1(body);
  const delimiter = `--${boundary}`;
  const parts: Uint8Array[] = [];
  let pos = s.indexOf(delimiter);
  while (pos >= 0) {
    let start = pos + delimiter.length;
    if (s.startsWith("--", start)) break; // closing delimiter
    start = s.indexOf("\n", start) + 1;
    if (start <= 0) break;
    const next = s.indexOf(`\n${delimiter}`, start);
    const stop = next < 0 ? s.length : next;
    parts.push(body.subarray(start, s[stop - 1] === "\r" ? stop - 1 : stop));
    pos = next < 0 ? -1 : next + 1;
  }
  return parts;
}

/** Bytes as a string of the same length (one char per byte), so offsets map back to bytes. */
function latin1(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return s;
}

function decodeQuotedPrintable(bytes: Uint8Array): Uint8Array {
  const s = latin1(bytes).replace(/=\r?\n/g, "");
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
      out.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(s.charCodeAt(i));
  }
  return Uint8Array.from(out);
}

function decodeBase64(bytes: Uint8Array): Uint8Array {
  return Uint8Array.from(atob(latin1(bytes).replace(/[^A-Za-z0-9+/=]/g, "")), (c) => c.charCodeAt(0));
}

function decodeCharset(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset.toLowerCase()).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

/** RFC 2047 encoded words, e.g. =?UTF-8?Q?Canceled=3A_Reservation?= */
function decodeWords(value: string): string {
  return value
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset: string, enc: string, text: string) => {
      const bytes = enc.toUpperCase() === "B"
        ? decodeBase64(new TextEncoder().encode(text))
        : decodeQuotedPrintable(new TextEncoder().encode(text.replace(/_/g, " ")));
      return decodeCharset(bytes, charset);
    });
}
