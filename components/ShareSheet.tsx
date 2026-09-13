'use client';

import { useEffect, useRef, useState } from 'react';
import type { Party } from '@/lib/types';
import { formatMoney } from '@/lib/format';
import { partyLabel, relativeDate } from '@/lib/store';
import { Sheet } from './Sheet';
import type { ShareLink } from '@/lib/cloud/api';
import { Copy, Link, Qr, Share, Trash } from './Icons';

export function ShareSheet({
  party,
  url,
  summary,
  sharedBy,
  cloudLinks,
  onCreateLink,
  onRevokeLink,
  onCopyLink,
  onCopySummary,
  onCopyText,
  onClose,
}: {
  party: Party;
  url: string;
  summary: string;
  sharedBy: string;
  /** Null when the app is local-only: there is no server to host a live link. */
  cloudLinks: ShareLink[] | null;
  onCreateLink: (role: 'view' | 'edit') => void;
  onRevokeLink: (token: string) => void;
  onCopyLink: () => void;
  onCopySummary: () => void;
  onCopyText: (text: string, message: string) => void;
  onClose: () => void;
}) {
  const [canNativeShare, setCanNativeShare] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);

  // navigator.share only exists on some browsers, and only over https.
  useEffect(() => {
    setCanNativeShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);

  const total = party.items.reduce((a, i) => a + i.amount, 0);

  const nativeShare = async () => {
    try {
      await navigator.share({
        title: `${partyLabel(party)} — BrosPayday`,
        text: summary,
        url,
      });
    } catch {
      /* the user dismissed the share sheet — nothing to report */
    }
  };

  return (
    <Sheet title="Share this event" onClose={onClose}>
      <div className="share-card">
        <div className="share-card-title">{partyLabel(party)}</div>
        <div className="share-card-meta num">
          {relativeDate(party.date)} · {party.people.length}{' '}
          {party.people.length === 1 ? 'person' : 'people'} · {party.items.length}{' '}
          {party.items.length === 1 ? 'expense' : 'expenses'}
        </div>
        <div className="share-card-total num">{formatMoney(total, party.currencyCode)}</div>
        <div className="share-card-by">shared by {sharedBy}</div>
      </div>

      <div className="share-actions">
        {canNativeShare && (
          <button type="button" className="btn primary block" onClick={nativeShare}>
            <Share />
            Share…
          </button>
        )}
        <button type="button" className="btn block" onClick={onCopyLink}>
          <Link />
          Copy link
        </button>
        <button type="button" className="btn block" onClick={onCopySummary}>
          <Copy />
          Copy summary for chat
        </button>
      </div>

      {cloudLinks && (
        <>
          <div className="divider" />
          <span className="label">A live link to this event</span>
          <p className="hint" style={{ marginBottom: 11 }}>
            Unlike the snapshot below, these stay in step with the party. Nobody needs to sign in.
          </p>

          {cloudLinks.length > 0 && (
            <div className="row-list" style={{ marginBottom: 11 }}>
              {cloudLinks.map((link) => {
                const url = `${typeof window === 'undefined' ? '' : window.location.origin}/?s=${link.token}`;
                return (
                  <div className="row-card" key={link.token}>
                    <span className={link.role === 'edit' ? 'pill accent' : 'pill'}>
                      {link.role === 'edit' ? 'Can edit' : 'View only'}
                    </span>
                    <span className="row-main">
                      <span className="row-sub" style={{ marginTop: 0 }}>
                        {url.replace(/^https?:\/\//, '')}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => onCopyText(url, 'Link copied')}
                      aria-label="Copy this link"
                    >
                      <Copy size={14} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn sm bare"
                      onClick={() => {
                        if (window.confirm('Revoke this link? Anyone using it loses access.')) {
                          onRevokeLink(link.token);
                        }
                      }}
                      aria-label="Revoke this link"
                    >
                      <Trash size={15} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="share-actions">
            <button type="button" className="btn block" onClick={() => onCreateLink('view')}>
              <Qr size={16} />
              New view-only link
            </button>
            <button type="button" className="btn block" onClick={() => onCreateLink('edit')}>
              <Share size={16} />
              New link they can add to
            </button>
          </div>
          <p className="hint" style={{ marginTop: 9 }}>
            An edit link lets someone add what they bought. It reaches this event and nothing else —
            not your other events, not your Group.
          </p>
        </>
      )}

      <div className="divider" />

      <label className="label" htmlFor="share-url">
        A snapshot link
      </label>
      <input
        id="share-url"
        ref={urlRef}
        className="field url-field"
        value={url}
        readOnly
        onFocus={(e) => e.currentTarget.select()}
        spellCheck={false}
      />

      <p className="hint" style={{ marginTop: 9 }}>
        This one packs the whole event into the link itself, so nothing is uploaded. Whoever opens
        it gets their own copy frozen at this moment; what they change never comes back to you.
      </p>
    </Sheet>
  );
}
