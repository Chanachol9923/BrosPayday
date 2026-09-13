'use client';

import { useState } from 'react';
import { Sheet } from './Sheet';
import { Arrow } from './Icons';

/** Someone read you a code. This turns it into the event it belongs to. */
export function OpenCodeSheet({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState('');

  const clean = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const ready = clean.length >= 6;

  const open = () => {
    if (!ready) return;
    window.location.href = `${window.location.origin}/?s=${clean}`;
  };

  return (
    <Sheet
      title="View/Join Event with a code"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={open} disabled={!ready}>
            <Arrow size={16} />
            Open
          </button>
        </>
      }
    >
      <p className="hint" style={{ marginBottom: 12 }}>
        Someone sharing an event can give you its code. You do not need an account — depending on
        the code you will either be able to look, or to add what you bought.
      </p>

      <input
        className="field code-field"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        onKeyDown={(e) => {
          if (e.key === 'Enter') open();
        }}
        placeholder="ABCD-2345"
        maxLength={9}
        aria-label="Event code"
        autoComplete="off"
        spellCheck={false}
        autoFocus
      />

      <p className="hint" style={{ marginTop: 9 }}>
        Eight characters, dash optional.
      </p>
    </Sheet>
  );
}
