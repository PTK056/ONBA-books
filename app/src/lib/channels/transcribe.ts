import "server-only";
import type { Session } from "@/lib/mcp/session";

// Voice notes → text, with OpenAI's transcription API (Claude does not take audio input).
const MODEL = process.env.TRANSCRIBE_MODEL ?? "gpt-4o-transcribe";

export const transcriptionEnabled = () => !!process.env.OPENAI_API_KEY;

/** Transcribes a voice note. The prompt gives the villa and category names so they come out spelled right. */
export async function transcribe(s: Session, audio: Uint8Array, mimeType = "audio/ogg"): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: mimeType }), mimeType.includes("ogg") ? "voice.ogg" : "voice.m4a");
  form.append("model", MODEL);
  form.append("prompt",
    `Bookkeeping note for short-term-rental villas: ${s.villas.map((v) => v.name).join(", ")}. `
    + `Categories: ${s.categories.map((c) => c.name).join(", ")}. Amounts in ${s.org.reportingCurrency}, e.g. "350k" = 350,000. `
    + "May mix French, English and Indonesian.");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || typeof body.text !== "string") throw new Error(`transcribe: ${res.status} ${body.error?.message ?? ""}`);
  return body.text.trim();
}
