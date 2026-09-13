'use client';

import { useEffect, useRef } from 'react';
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
  const bodyRef = useRef<HTMLDivElement>(null);

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

  // Shrinking the sheet is not enough on its own: a field low down can still end
  // up behind the keyboard, so bring whatever was tapped into view once the
  // keyboard has finished animating in.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;

    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      window.setTimeout(() => {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 280);
    };

    body.addEventListener('focusin', onFocus);
    return () => body.removeEventListener('focusin', onFocus);
  }, []);

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

        <div className="sheet-body" ref={bodyRef}>
          {children}
        </div>

        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}
