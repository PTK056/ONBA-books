import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Tokens at rest: AES-256-GCM with CHANNEL_TOKEN_KEY (32 bytes, base64), kept outside the database.
function key() {
  const k = Buffer.from(process.env.CHANNEL_TOKEN_KEY ?? "", "base64");
  if (k.length !== 32) throw new Error("CHANNEL_TOKEN_KEY must be 32 bytes, base64");
  return k;
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(sealed: string): string {
  const [iv, tag, body] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString("utf8");
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 24) => randomBytes(bytes).toString("base64url");
