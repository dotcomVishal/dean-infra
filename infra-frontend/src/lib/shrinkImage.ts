// Phone photos are 3 to 8 MB. Shrink them in the browser before upload so
// every later download of the thumbnail is small too. Non-images, HEIC and
// anything that fails to decode are returned untouched.
const MAX_EDGE = 2000;
const QUALITY = 0.82;
const SHRINKABLE = ['image/jpeg', 'image/png', 'image/webp'];

export async function shrinkImage(file: File): Promise<File> {
  if (!SHRINKABLE.includes(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.fillStyle = '#fff'; // a transparent PNG would turn black as JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', QUALITY));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified });
  } catch {
    return file;
  }
}

export const shrinkAll = (files: File[]) => Promise.all(files.map(shrinkImage));
