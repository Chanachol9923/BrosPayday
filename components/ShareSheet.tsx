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
  onRevokeLink: (role: 'view' | 'edit') => void;
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
          <span className="label">This event&rsquo;s codes</span>
          <p className="hint" style={{ marginBottom: 11 }}>
            One code per event. Whoever has it sees this event and nothing else of yours — no
            sign-in needed, and you can revoke it whenever.
          </p>

          <div className="code-grid">
            {(['view', 'edit'] as const).map((role) => {
              const existing = cloudLinks.find((l) => l.role === role);
              // The card's heading and the word used mid-sentence are not the same
              // thing: "Revoke the join group link (can edit) code?" reads badly.
              const heading = role === 'edit' ? 'Join Group Link (Can Edit)' : 'View only';
              const shortName = role === 'edit' ? 'edit' : 'view';

              return (
                <div className={`code-card${role === 'edit' ? ' editable' : ''}`} key={role}>
                  <span className="code-role">{heading}</span>

                  {existing ? (
                    <>
                      <button
                        type="button"
                        className="code-value num"
                        onClick={() =>
                          onCopyText(
                            existing.token,
                            `${shortName === 'edit' ? 'Edit' : 'View'} code copied`,
                          )
                        }
                        title="Copy this code"
                      >
                        {existing.token.slice(0, 4)}
                        <span className="code-gap">-</span>
                        {existing.token.slice(4)}
                      </button>

                      <div className="code-actions">
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() =>
                            onCopyText(
                              `${typeof window === 'undefined' ? '' : window.location.origin}/?s=${existing.token}`,
                              'Link copied',
                            )
                          }
                        >
                          <Copy size={13} />
                          Link
                        </button>
                        <button
                          type="button"
                          className="icon-btn sm bare"
                          onClick={() => {
                            if (
                              window.confirm(
                                `Revoke the ${shortName} code? Anyone using it loses access.`,
                              )
                            ) {
                              onRevokeLink(role);
                            }
                          }}
                          aria-label={`Revoke the ${shortName} code`}
                        >
                          <Trash size={14} />
                        </button>
                      </div>
                    </>
                  ) : (
                    <button type="button" className="btn sm block" onClick={() => onCreateLink(role)}>
                      {role === 'edit' ? <Share size={14} /> : <Qr size={14} />}
                      Make a code
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <p className="hint" style={{ marginTop: 10 }}>
            An <b>add</b> code lets someone put in what they bought. It reaches this event only —
            not your other events, not your account.
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
