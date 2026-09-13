'use client';

import { useEffect, useState } from 'react';
import { photoUrl } from '@/lib/photos';

/**
 * Blobs live in IndexedDB, so every image has to be fetched and turned into an
 * object URL before it can be shown. The URLs are cached in lib/photos and
 * revoked when the photo is deleted, so nothing is revoked out from under a
 * component that is still mounted.
 */
export function usePhotoUrl(id: string | null | undefined, kind: 'full' | 'thumb' = 'thumb') {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!id) {
      setUrl(null);
      return;
    }
    photoUrl(id, kind)
      .then((next) => {
        if (alive) setUrl(next);
      })
      .catch(() => {
        if (alive) setUrl(null);
      });
    return () => {
      alive = false;
    };
  }, [id, kind]);

  return url;
}

export function Photo({
  id,
  kind = 'thumb',
  alt,
  className,
}: {
  id: string;
  kind?: 'full' | 'thumb';
  alt: string;
  className?: string;
}) {
  const url = usePhotoUrl(id, kind);

  if (!url) return <span className={`photo-skeleton ${className ?? ''}`} aria-hidden />;
  // eslint-disable-next-line @next/next/no-img-element -- object URLs from IndexedDB, not remote assets
  return <img src={url} alt={alt} className={className} loading="lazy" decoding="async" />;
}
