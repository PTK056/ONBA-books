// Turns a picked file into something the receipt engine accepts: PDFs as they are,
// photos re-encoded as JPEG no larger than MAX_SIDE (smaller uploads, EXIF rotation applied,
// and formats like HEIC converted when the browser can decode them).

const MAX_SIDE = 2000;
const JPEG_QUALITY = 0.85;
const MAX_PDF_BYTES = 10 * 1024 * 1024;

export interface Prepared { blob: Blob; mimeType: string; extension: string }

export async function prepareFile(file: File): Promise<Prepared> {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    if (file.size > MAX_PDF_BYTES) throw new Error("PDF larger than 10 MB");
    return { blob: file, mimeType: "application/pdf", extension: "pdf" };
  }
  if (!file.type.startsWith("image/") && !/\.(heic|heif)$/i.test(file.name)) {
    throw new Error("Not a photo or PDF");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("This photo format can't be opened in this browser; export it as JPEG");
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  if (!blob) throw new Error("Could not prepare the photo");
  return { blob, mimeType: "image/jpeg", extension: "jpg" };
}
