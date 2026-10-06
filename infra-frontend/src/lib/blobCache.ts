// X1: a thumbnail used to be refetched on every mount, so one page refresh of
// an attachment-heavy ticket cost a request per file. Object URLs are kept in
// memory only (never storage: shared PCs, S14), capped, and dropped on logout.
const MAX = 80;
const cache = new Map<string, Promise<string>>();

const revoke = (p?: Promise<string>) => p?.then((u) => URL.revokeObjectURL(u), () => {});

export function cachedObjectUrl(key: string, load: () => Promise<Blob>): Promise<string> {
  let hit = cache.get(key);
  if (!hit) {
    hit = load().then((blob) => URL.createObjectURL(blob));
    hit.catch(() => cache.delete(key)); // a failure is not cached
    cache.set(key, hit);
    if (cache.size > MAX) {
      const oldest = cache.keys().next().value as string;
      revoke(cache.get(oldest));
      cache.delete(oldest);
    }
  }
  return hit;
}

export function clearBlobCache() {
  for (const p of cache.values()) revoke(p);
  cache.clear();
}
