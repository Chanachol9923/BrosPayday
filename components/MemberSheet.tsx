'use client';

import { useEffect, useRef, useState } from 'react';
import type { Payee, Person } from '@/lib/types';
import { buildPromptPayPayload, describePromptPayId, parsePromptPayId, promptPayKindLabel } from '@/lib/promptpay';
import { Avatar } from './Avatar';
import { Photo } from './Photo';
import { QrCode } from './QrCode';
import { Sheet } from './Sheet';
import { Plus, Qr, Trash, X } from './Icons';

export function MemberSheet({
  person,
  hue,
  payee,
  uses,
  busy,
  onRename,
  onSetQrImage,
  onClearQrImage,
  onSetPromptPay,
  onRemove,
  onClose,
}: {
  person: Person;
  hue: number;
  payee: Payee | null;
  uses: number;
  busy: boolean;
  onRename: (name: string) => void;
  onSetQrImage: (file: File) => void;
  onClearQrImage: () => void;
  onSetPromptPay: (value: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [promptPay, setPromptPay] = useState(payee?.promptPayId ?? '');

  const target = parsePromptPayId(promptPay);
  const preview = target ? buildPromptPayPayload(promptPay) : null;

  // Paste a QR screenshot straight in, which is how it usually arrives on a laptop.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) return;
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
      if (file) {
        e.preventDefault();
        onSetQrImage(file);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onSetQrImage]);

  /**
   * Save as soon as the digits make sense rather than waiting for a blur —
   * typing a number and closing the sheet straight away used to lose it.
   * Half-typed input is held back so a partial number never gets stored.
   */
  const changePromptPay = (next: string) => {
    setPromptPay(next);
    const trimmed = next.trim();
    if (trimmed === '' || parsePromptPayId(trimmed)) onSetPromptPay(trimmed);
  };

  return (
    <Sheet title={person.name || 'Member'} onClose={onClose}>
      <div className="member-head">
        <Avatar name={person.name} hue={hue} size="lg" />
        <input
          className="field"
          value={person.name}
          onChange={(e) => onRename(e.target.value)}
          placeholder="Name"
          aria-label="Member name"
          autoComplete="off"
        />
      </div>

      <div className="divider" />

      <span className="label">Getting paid back — optional</span>
      <p className="hint" style={{ marginBottom: 12 }}>
        Add a payment QR and anyone who owes {person.name || 'them'} can scan it straight from the
        settle-up screen. Saved against the name, so it comes back automatically in your next party.
      </p>

      {/* ── a pasted QR image ─────────────────────────────────── */}
      <div className="pay-option">
        <div className="row-between" style={{ marginBottom: 9 }}>
          <span className="pay-option-title">
            <Qr size={15} /> Their QR image
          </span>
          {payee?.qrPhotoId && (
            <button type="button" className="btn sm ghost" onClick={onClearQrImage}>
              <X size={13} />
              Remove
            </button>
          )}
        </div>

        {payee?.qrPhotoId ? (
          <div className="pay-qr-preview">
            <Photo id={payee.qrPhotoId} kind="full" alt={`${person.name}'s payment QR`} />
          </div>
        ) : (
          <button
            type="button"
            className="photo-add wide"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            <Plus size={20} />
            <span>{busy ? 'Saving…' : 'Paste or upload a QR screenshot'}</span>
          </button>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onSetQrImage(file);
            e.target.value = '';
          }}
        />
      </div>

      {/* ── or a PromptPay number ─────────────────────────────── */}
      <div className="pay-option">
        <span className="pay-option-title" style={{ marginBottom: 9, display: 'flex' }}>
          Or a PromptPay number
        </span>

        <input
          className="field"
          value={promptPay}
          onChange={(e) => changePromptPay(e.target.value)}
          placeholder="Phone or ID number"
          inputMode="numeric"
          autoComplete="off"
          aria-label="PromptPay number"
        />

        {promptPay.trim() !== '' && !target && (
          <p className="hint warn" style={{ marginTop: 7 }}>
            That is not a phone number (10 digits) or an ID number (13 digits) yet.
          </p>
        )}

        {target && preview && (
          <>
            <p className="hint" style={{ marginTop: 7 }}>
              Reads as a {promptPayKindLabel(target.kind)}:{' '}
              <b style={{ color: 'var(--text)' }}>{describePromptPayId(promptPay)}</b> — check that
              against what {person.name || 'they'} actually gave you.
            </p>
            <div className="pay-qr-preview small">
              <QrCode value={preview} size={140} />
            </div>
            <p className="hint" style={{ marginTop: 7 }}>
              With a number, the app can build a QR that already has the exact amount in it.
            </p>
          </>
        )}
      </div>

      <div className="divider" />

      <button type="button" className="btn danger block" onClick={onRemove}>
        <Trash />
        Remove from this party
        {uses > 0 && <span className="hint" style={{ marginLeft: 6 }}>({uses} expenses)</span>}
      </button>
    </Sheet>
  );
}
