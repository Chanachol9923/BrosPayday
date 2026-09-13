'use client';

import { useEffect, useRef, useState } from 'react';
import type { Party } from '@/lib/types';
import { formatMoney } from '@/lib/format';
import { partyLabel, relativeDate } from '@/lib/store';
import { eventCodeUrl } from '@/lib/share';
import { Sheet } from './Sheet';
import type { ShareLink } from '@/lib/cloud/api';
import { Cloud, Copy, Eye, Link, Qr, Share, Trash } from './Icons';

export function ShareSheet({
  party,
  url,
  summary,
  sharedBy,
  cloudLinks,
  inviteUrl,
  viewUrl,
  onCreateLink,
  onRevokeLink,
  onCopySummary,
  onCopyText,
  onClose,
  onSignIn,
}: {
  party: Party;
  url: string;
  summary: string;
  sharedBy: string;
  /** Null when the app is local-only: there is no server to host a live link. */
  cloudLinks: ShareLink[] | null;
  /** The live edit-invite link, once this event has an edit code. */
  inviteUrl: string | null;
  /** The live look-but-don't-touch link, once this event has a view code. */
  viewUrl: string | null;
  onCreateLink: (role: 'view' | 'edit') => void;
  onRevokeLink: (role: 'view' | 'edit') => void;
  onCopySummary: () => void;
  onCopyText: (text: string, message: string) => void;
  onClose: () => void;
  /** Given only when there is an account to sign in to and nobody is signed in. */
  onSignIn?: () => void;
}) {
  const [canNativeShare, setCanNativeShare] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);

  // navigator.share only exists on some browsers, and only over https.
  useEffect(() => {
    setCanNativeShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);

  const total = party.items.reduce((a, i) => a + i.amount, 0);

  // With cloud sync on, the thing worth handing someone is the live invite; the
  // snapshot link below is the fallback for a local-only app.
  const primaryUrl = inviteUrl ?? url;
  const invites = inviteUrl !== null;

  /** Tapping the field itself copies: nobody wants to drag-select a URL on a phone. */
  const copySnapshot = () => {
    urlRef.current?.select();
    onCopyText(url, 'Snapshot link copied');
  };

  const nativeShare = async () => {
    try {
      await navigator.share({
        title: `${partyLabel(party)} — BrosPayday`,
        text: summary,
        url: primaryUrl,
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

      <span className={invites ? 'label invite-label' : 'label'}>
        {invites ? 'Invite to Join Event (Can Edit)' : 'View Only Link'}
      </span>

      <div className="share-actions">
        {canNativeShare && (
          <button type="button" className="btn primary block" onClick={nativeShare}>
            <Share />
            {invites ? 'Share Invite Link (Can Edit)' : 'Share View Only Link'}
          </button>
        )}
        <button
          type="button"
          className={canNativeShare ? 'btn block' : 'btn primary block'}
          onClick={() =>
            onCopyText(primaryUrl, invites ? 'Invite link copied' : 'View link copied')
          }
        >
          {invites ? <Link /> : <Eye />}
          {invites ? 'Copy Invite Link (Can Edit)' : 'Copy View Only Link'}
        </button>
        {viewUrl && (
          <button
            type="button"
            className="btn block"
            onClick={() => onCopyText(viewUrl, 'View link copied')}
          >
            <Eye />
            Copy View Only Link
          </button>
        )}
        <button type="button" className="btn block" onClick={onCopySummary}>
          <Copy />
          Copy summary for chat
        </button>
      </div>

      {!invites && (
        <div className="share-note">
          <p className="hint" style={{ margin: 0 }}>
            Without an account this is the only kind of link there is. It carries the numbers
            inside itself — nothing is uploaded — and whoever opens it gets their own copy: they
            can change nothing of yours, and nothing they do comes back to you.
          </p>
          {onSignIn && (
            <>
              <p className="hint" style={{ margin: '8px 0 9px' }}>
                Sign in and you can also hand out a link people add their own spending to, and
                watch it land on your screen.
              </p>
              <button type="button" className="btn sm primary" onClick={onSignIn}>
                <Cloud size={15} />
                Sign in for an editable link
              </button>
            </>
          )}
        </div>
      )}

      {invites && (
        <p className="hint" style={{ marginTop: 9 }}>
          Both are the codes below, as links — the same ones, so revoking a code there kills its
          link too. The invite lets someone add what they bought, to this event only, and they sign
          in first so every change has a name on it. The view link opens for anyone, with no account
          and nothing to press.
        </p>
      )}

      {cloudLinks && (
        <>
          <div className="divider" />
          <span className="label">This event&rsquo;s codes</span>
          <p className="hint" style={{ marginBottom: 11 }}>
            One code per event. Whoever has it sees this event and nothing else of yours, and you
            can revoke it whenever. Looking needs no account; editing does.
          </p>

          <div className="code-grid">
            {(['view', 'edit'] as const).map((role) => {
              const existing = cloudLinks.find((l) => l.role === role);
              // The card's heading and the word used mid-sentence are not the same
              // thing: "Revoke the join group link (can edit) code?" reads badly.
              const heading = role === 'edit' ? 'Invite to Join Event (Can Edit)' : 'View only';
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
                              eventCodeUrl(
                                typeof window === 'undefined' ? '' : window.location.origin,
                                existing.token,
                              ),
                              role === 'edit' ? 'Invite link copied' : 'View link copied',
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
        {invites ? 'A snapshot link' : 'That link in full'}
      </label>
      <div className="url-row">
        <input
          id="share-url"
          ref={urlRef}
          className="field url-field"
          value={url}
          readOnly
          onFocus={(e) => e.currentTarget.select()}
          onClick={copySnapshot}
          title="Tap to copy"
          spellCheck={false}
        />
        <button
          type="button"
          className="icon-btn"
          onClick={copySnapshot}
          aria-label="Copy the snapshot link"
        >
          <Copy size={16} />
        </button>
      </div>

      <p className="hint" style={{ marginTop: 9 }}>
        {invites
          ? 'This one packs the whole event into the link itself, so nothing is uploaded. Whoever opens it gets their own copy frozen at this moment; what they change never comes back to you — unlike the codes above, which stay live.'
          : 'The same link the button above copies, in case you would rather read it than trust a button. It is frozen at this moment: share it again later and the new one carries the newer numbers.'}
      </p>
    </Sheet>
  );
}
