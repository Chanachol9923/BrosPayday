'use client';

import { useEffect } from 'react';
import { X } from './Icons';

/**
 * The one modal shell: a bottom sheet on phones, a centred dialog on desktop.
 * Owns the scroll lock and the Escape key so no caller has to remember them.
 */
export function Sheet({
  title,
  onClose,
  children,
  footer,
  headerRight,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  headerRight?: React.ReactNode;
}) {
  useEffect(() => {
    document.body.classList.add('is-locked');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('is-locked');
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-grip" />

        <div className="sheet-head">
          <span className="sheet-title">{title}</span>
          {headerRight}
          <button type="button" className="icon-btn bare" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="sheet-body">{children}</div>

        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}
