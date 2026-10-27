/**
 * Turns a picked file into what gets uploaded.
 *
 * Photographs are re-encoded as a JPEG no wider than 2400px, as the Flutter
 * picker does: enough to read an expiry date, small enough to send on a car
 * park's signal. PDFs and HEIC (which most browsers cannot decode) go as they
 * are. Anything the API would refuse is refused here first, in words.
 */
import { validationFailure } from '../api/failures';

const MAX_EDGE = 2400;
const QUALITY = 0.85;
const DECODABLE = ['image/jpeg', 'image/png', 'image/webp'];
const AS_IS = ['application/pdf', 'image/heic', 'image/jpeg', 'image/png'];

export async function prepareDocument(
  file: File,
): Promise<{ body: Blob; contentType: string }> {
  const type = file.type.toLowerCase();

  if (DECODABLE.includes(type)) {
    const jpeg = await downscale(file).catch(() => null);
    if (jpeg) return { body: jpeg, contentType: 'image/jpeg' };
  }
  if (AS_IS.includes(type)) return { body: file, contentType: type };

  throw validationFailure('Choose a photo (JPEG, PNG or HEIC) or a PDF.');
}

async function downscale(file: File): Promise<Blob | null> {
  if (typeof createImageBitmap !== 'function') return null;
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', QUALITY),
    );
  } finally {
    bitmap.close();
  }
}
