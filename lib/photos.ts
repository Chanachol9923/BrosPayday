/**
 * Photo storage.
 *
 * Photos never go near localStorage — a few phone snaps would blow past its ~5MB
 * quota and take the whole party history down with them. The blobs live in
 * IndexedDB (gigabytes available) and the party record keeps only small metadata.
 *
 * Every image is re-encoded on the way in: a full-size copy capped at 1600px for
 * reading a receipt, and a 240px thumbnail so a grid of forty photos still scrolls.
 * A 4MB phone photo typically lands around 250KB.
 */

const DB_NAME = 'brospayday-photos';
const DB_VERSION = 1;
const STORE = 'photos';

const MAX_EDGE = 1600;
const THUMB_EDGE = 240;
const THUMB_QUALITY = 0.7;

/**
 * Receipts are read, not admired. What keeps small print legible is resolution,
 * not JPEG quality, so the long edge is held at 1600px and quality is spent down
 * instead until the file fits a budget — with a floor, because below about 0.6
 * the ringing around thin Thai glyphs starts to eat them.
 */
const TARGET_BYTES = 180 * 1024;
const START_QUALITY = 0.82;
const MIN_QUALITY = 0.62;
const QUALITY_STEP = 0.08;

export type StoredPhoto = {
  id: string;
  full: Blob;
  thumb: Blob;
  w: number;
  h: number;
  bytes: number;
  addedAt: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser has no IndexedDB, so photos cannot be stored.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open the photo store.'));
  });

  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const req = run(transaction.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        transaction.onabort = () => reject(transaction.error);
      }),
  );
}

/* ── encoding ────────────────────────────────────────────────────── */

function scaleTo(w: number, h: number, maxEdge: number) {
  const longest = Math.max(w, h);
  if (longest <= maxEdge) return { w, h };
  const ratio = maxEdge / longest;
  return { w: Math.round(w * ratio), h: Math.round(h * ratio) };
}

async function encode(bitmap: ImageBitmap, maxEdge: number, quality: number): Promise<Blob> {
  const { w, h } = scaleTo(bitmap.width, bitmap.height, maxEdge);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not prepare the image.');
  ctx.drawImage(bitmap, 0, 0, w, h);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality),
  );
  if (!blob) throw new Error('Could not compress the image.');
  return blob;
}

/** Step the quality down until the file fits, never past the legibility floor. */
async function encodeWithinBudget(
  bitmap: ImageBitmap,
  maxEdge: number,
  targetBytes: number,
): Promise<Blob> {
  let quality = START_QUALITY;
  let blob = await encode(bitmap, maxEdge, quality);

  while (blob.size > targetBytes && quality > MIN_QUALITY) {
    quality = Math.max(MIN_QUALITY, Number((quality - QUALITY_STEP).toFixed(2)));
    blob = await encode(bitmap, maxEdge, quality);
  }

  return blob;
}

async function toBitmap(file: File): Promise<ImageBitmap> {
  // from-image applies the EXIF rotation phones bake in, so portrait shots
  // do not come back on their side.
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return await createImageBitmap(file);
  }
}

export type SavedPhoto = { id: string; w: number; h: number; bytes: number; addedAt: number };

export type SaveOptions = {
  /** Longest edge of the stored copy. */
  maxEdge?: number;
  /** Fixed quality. Set this to opt out of the size budget entirely. */
  quality?: number;
  /** Size to aim for, in bytes. Ignored when `quality` is given. */
  targetBytes?: number;
};

/**
 * A payment QR has to survive being re-encoded and then read back by a camera,
 * so it keeps more resolution and far less compression than a receipt snap.
 * JPEG artefacts around the finder patterns are what make a re-saved QR fail.
 */
export const QR_ENCODE: SaveOptions = { maxEdge: 1200, quality: 0.95 };

export async function savePhoto(file: File, id: string, opts: SaveOptions = {}): Promise<SavedPhoto> {
  const maxEdge = opts.maxEdge ?? MAX_EDGE;

  const bitmap = await toBitmap(file);
  try {
    const [full, thumb] = await Promise.all([
      opts.quality !== undefined
        ? encode(bitmap, maxEdge, opts.quality)
        : encodeWithinBudget(bitmap, maxEdge, opts.targetBytes ?? TARGET_BYTES),
      encode(bitmap, THUMB_EDGE, THUMB_QUALITY),
    ]);
    const { w, h } = scaleTo(bitmap.width, bitmap.height, maxEdge);
    const record: StoredPhoto = { id, full, thumb, w, h, bytes: full.size + thumb.size, addedAt: Date.now() };

    await tx('readwrite', (store) => store.put(record) as IDBRequest<IDBValidKey>);
    return { id, w, h, bytes: record.bytes, addedAt: record.addedAt };
  } finally {
    bitmap.close?.();
  }
}

/* ── reading ─────────────────────────────────────────────────────── */

const urlCache = new Map<string, string>();

/**
 * How to fetch a photo this device has never seen. Set by the app when cloud sync
 * is on; without it, IndexedDB is the only source and a photo taken on another
 * phone simply is not available — which is the correct local-only behaviour.
 */
type CloudFetcher = (photoId: string) => Promise<Blob | null>;
let fetchFromCloud: CloudFetcher | null = null;

export function setCloudPhotoFetcher(fetcher: CloudFetcher | null): void {
  fetchFromCloud = fetcher;
}

export async function getPhotoBlob(id: string, kind: 'full' | 'thumb' = 'full'): Promise<Blob | null> {
  const record = await tx<StoredPhoto | undefined>('readonly', (store) => store.get(id));
  if (!record) return null;
  return kind === 'full' ? record.full : record.thumb;
}

/** Put a blob fetched from elsewhere into the local cache, thumbnail and all. */
export async function cachePhoto(id: string, full: Blob): Promise<StoredPhoto | null> {
  try {
    const bitmap = await createImageBitmap(full);
    try {
      const thumb = await encode(bitmap, THUMB_EDGE, THUMB_QUALITY);
      const record: StoredPhoto = {
        id,
        full,
        thumb,
        w: bitmap.width,
        h: bitmap.height,
        bytes: full.size + thumb.size,
        addedAt: Date.now(),
      };
      await tx('readwrite', (store) => store.put(record) as IDBRequest<IDBValidKey>);
      return record;
    } finally {
      bitmap.close?.();
    }
  } catch {
    return null;
  }
}

export async function photoUrl(id: string, kind: 'full' | 'thumb' = 'thumb'): Promise<string | null> {
  const key = `${id}:${kind}`;
  const cached = urlCache.get(key);
  if (cached) return cached;

  let record = await tx<StoredPhoto | undefined>('readonly', (store) => store.get(id));

  // Not on this device yet — pull it down once and keep it.
  if (!record && fetchFromCloud) {
    const blob = await fetchFromCloud(id).catch(() => null);
    if (blob) record = (await cachePhoto(id, blob)) ?? undefined;
  }

  if (!record) return null;

  const url = URL.createObjectURL(kind === 'full' ? record.full : record.thumb);
  urlCache.set(key, url);
  return url;
}

function forgetUrls(id: string) {
  for (const kind of ['full', 'thumb'] as const) {
    const key = `${id}:${kind}`;
    const url = urlCache.get(key);
    if (url) {
      URL.revokeObjectURL(url);
      urlCache.delete(key);
    }
  }
}

/* ── deleting ────────────────────────────────────────────────────── */

export async function deletePhoto(id: string): Promise<void> {
  forgetUrls(id);
  await tx('readwrite', (store) => store.delete(id) as IDBRequest<undefined>);
}

export async function deletePhotos(ids: string[]): Promise<void> {
  for (const id of ids) {
    try {
      await deletePhoto(id);
    } catch {
      /* one failure should not strand the rest */
    }
  }
}

/**
 * Drop any blob no party still references. Deleting a party or trimming history
 * can leave orphans behind; this runs on start-up so they cannot pile up forever.
 */
export async function sweepOrphans(keepIds: Set<string>): Promise<number> {
  try {
    const all = await tx<IDBValidKey[]>('readonly', (store) => store.getAllKeys());
    const orphans = all.map(String).filter((id) => !keepIds.has(id));
    await deletePhotos(orphans);
    return orphans.length;
  } catch {
    return 0;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
