'use client';

import { useEffect } from 'react';
import type { Item, PhotoMeta } from '@/lib/types';
import { formatBytes } from '@/lib/photos';
import { formatMoney } from '@/lib/format';
import { Photo } from './Photo';
import { Chevron, Trash, X } from './Icons';

export function PhotoViewer({
  photos,
  index,
  items,
  currencyCode,
  onIndex,
  onLink,
  onDelete,
  onClose,
}: {
  photos: PhotoMeta[];
  index: number;
  items: Item[];
  currencyCode: string;
  onIndex: (next: number) => void;
  onLink: (photoId: string, expenseId: string | null) => void;
  onDelete: (photoId: string) => void;
  onClose: () => void;
}) {
  const photo = photos[index];

  useEffect(() => {
    document.body.classList.add('is-locked');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      if (e.key === 'ArrowRight' && index < photos.length - 1) onIndex(index + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('is-locked');
      window.removeEventListener('keydown', onKey);
    };
  }, [index, photos.length, onIndex, onClose]);

  if (!photo) return null;

  return (
    <div
      className="overlay viewer"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="viewer-shell" role="dialog" aria-modal="true" aria-label="Photo">
        <div className="viewer-bar">
          <span className="viewer-count num">
            {index + 1} / {photos.length} · {formatBytes(photo.bytes)}
          </span>
          <button type="button" className="icon-btn bare" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="viewer-stage">
          {index > 0 && (
            <button
              type="button"
              className="viewer-nav prev"
              onClick={() => onIndex(index - 1)}
              aria-label="Previous photo"
            >
              <Chevron size={22} />
            </button>
          )}

          <Photo id={photo.id} kind="full" alt="Receipt" className="viewer-img" />

          {index < photos.length - 1 && (
            <button
              type="button"
              className="viewer-nav next"
              onClick={() => onIndex(index + 1)}
              aria-label="Next photo"
            >
              <Chevron size={22} />
            </button>
          )}
        </div>

        <div className="viewer-foot">
          <span className="label" style={{ marginBottom: 8 }}>
            Attach to an expense
          </span>

          {items.length === 0 ? (
            <p className="hint">No expenses yet — add one and you can attach this to it.</p>
          ) : (
            <div className="picker">
              <button
                type="button"
                className="pick plain"
                aria-pressed={photo.expenseId === null}
                onClick={() => onLink(photo.id, null)}
              >
                Not attached
              </button>
              {items.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className="pick plain"
                  aria-pressed={photo.expenseId === item.id}
                  onClick={() => onLink(photo.id, photo.expenseId === item.id ? null : item.id)}
                >
                  {item.name || 'Untitled'}
                  <span className="pick-amount num">{formatMoney(item.amount, currencyCode)}</span>
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            className="btn danger block"
            style={{ marginTop: 14 }}
            onClick={() => {
              if (window.confirm('Delete this photo?')) onDelete(photo.id);
            }}
          >
            <Trash />
            Delete photo
          </button>
        </div>
      </div>
    </div>
  );
}
