'use client';

import { useEffect, useRef, useState } from 'react';
import type { Item, PhotoMeta } from '@/lib/types';
import { formatBytes } from '@/lib/photos';
import { Photo } from './Photo';
import { Camera, Link as LinkIcon, Plus } from './Icons';

export function PhotoShelf({
  photos,
  items,
  busy,
  onAdd,
  onOpen,
  readOnly = false,
}: {
  photos: PhotoMeta[];
  items: Item[];
  busy: number;
  onAdd: (files: File[]) => void;
  onOpen: (id: string) => void;
  /** Receipts are the whole point of a view link, so they stay visible — just not addable. */
  readOnly?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const totalBytes = photos.reduce((a, p) => a + p.bytes, 0);
  const nameOf = (id: string | null) => items.find((i) => i.id === id)?.name ?? '';

  // Paste straight from the clipboard — handy on a laptop, where a screenshot
  // of a receipt or a QR is usually already on the clipboard.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (readOnly) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (files.length > 0) {
        e.preventDefault();
        onAdd(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onAdd]);

  const takeFiles = (list: FileList | null) => {
    if (readOnly) return;
    const files = Array.from(list ?? []).filter((f) => f.type.startsWith('image/'));
    if (files.length > 0) onAdd(files);
  };

  return (
    <section className="card">
      <div className="card-head">
        <Camera />
        <h2 className="card-title">Photos</h2>
        {photos.length > 0 && (
          <span className="pill">
            {photos.length} · {formatBytes(totalBytes)}
          </span>
        )}
        {busy > 0 && <span className="pill accent">adding {busy}…</span>}
      </div>

      <div className="card-body">
        <div
          className={`photo-grid${dragging ? ' dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            takeFiles(e.dataTransfer.files);
          }}
        >
          {photos.map((photo) => {
            const linked = photo.expenseId ? nameOf(photo.expenseId) : '';
            return (
              <button
                type="button"
                key={photo.id}
                className="photo-tile"
                onClick={() => onOpen(photo.id)}
                aria-label={linked ? `Photo for ${linked}` : 'Photo'}
              >
                <Photo id={photo.id} alt={linked || 'Receipt photo'} />
                {linked && (
                  <span className="photo-tag">
                    <LinkIcon size={10} />
                    {linked}
                  </span>
                )}
              </button>
            );
          })}

          {!readOnly && (
            <button
              type="button"
              className="photo-add"
              onClick={() => fileRef.current?.click()}
              aria-label="Add photos"
            >
              <Plus size={22} />
              <span>Add</span>
            </button>
          )}
        </div>

        {!readOnly && (
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              takeFiles(e.target.files);
              e.target.value = '';
            }}
          />
        )}

        <p className="hint" style={{ marginTop: 10 }}>
          {readOnly
            ? 'Tap one to see it full size.'
            : photos.length === 0
              ? 'Snap receipts as you go — as many as you like. Tap one later to attach it to an expense.'
              : 'Stored on this device only. Photos do not travel in a share link.'}
        </p>
      </div>
    </section>
  );
}
