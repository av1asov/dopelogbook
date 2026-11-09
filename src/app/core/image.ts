const MAX_SIDE = 2400;
const QUALITY = 0.85;

/** The photo after that many quarter turns clockwise. */
export async function turnedPhoto(photo: Blob, turns: number): Promise<Blob> {
  const bitmap = await createImageBitmap(photo);
  const canvas = document.createElement('canvas');
  canvas.width = turns % 2 ? bitmap.height : bitmap.width;
  canvas.height = turns % 2 ? bitmap.width : bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas is unavailable');
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((turns * Math.PI) / 2);
  context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', QUALITY),
  );
  if (!blob) throw new Error('could not encode the turned photo');
  return blob;
}

/** Target photos are scaled down to JPEG; a file the browser cannot decode is kept as is. */
export async function shrinkPhoto(file: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', QUALITY),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}
