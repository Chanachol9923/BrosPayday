'use client';

import { useEffect, useRef, useState } from 'react';
import type { Party } from '@/lib/types';
import { formatMoney } from '@/lib/format';
import { partyLabel, relativeDate } from '@/lib/store';
import { Sheet } from './Sheet';
import { Copy, Link, Share } from './Icons';

export function ShareSheet({
  party,
  url,
  summary,
  sharedBy,
  onCopyLink,
  onCopySummary,
  onClose,
}: {
  party: Party;
  url: string;
  summary: string;
  sharedBy: string;
  onCopyLink: () => void;
  onCopySummary: () => void;
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
    <Sheet title="Share this party" onClose={onClose}>
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

      <label className="label" htmlFor="share-url" style={{ marginTop: 15 }}>
        The link
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
        The whole party is packed into the link itself — nothing is uploaded anywhere and there is
        no server holding your numbers. Whoever opens it gets their own copy to keep or edit;
        changes they make don&rsquo;t come back to you.
      </p>
    </Sheet>
  );
}
