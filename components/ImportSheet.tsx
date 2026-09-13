'use client';

import type { SharedParty } from '@/lib/share';
import { formatMoney } from '@/lib/format';
import { partyLabel, relativeDate } from '@/lib/store';
import { hueForIndex } from '@/lib/colors';
import { Avatar } from './Avatar';
import { Sheet } from './Sheet';
import { Inbox } from './Icons';

export function ImportSheet({
  shared,
  onOpen,
  onSaveOnly,
  onClose,
}: {
  shared: SharedParty;
  onOpen: () => void;
  onSaveOnly: () => void;
  onClose: () => void;
}) {
  const { party, sharedBy } = shared;
  const total = party.items.reduce((a, i) => a + i.amount, 0);

  return (
    <Sheet
      title="Someone shared a party"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onSaveOnly}>
            Save to history
          </button>
          <button type="button" className="btn primary" onClick={onOpen}>
            Open it
          </button>
        </>
      }
    >
      <div className="share-card">
        <div className="share-card-title">{partyLabel(party)}</div>
        <div className="share-card-meta num">
          {relativeDate(party.date)} · {party.items.length}{' '}
          {party.items.length === 1 ? 'expense' : 'expenses'}
        </div>
        <div className="share-card-total num">{formatMoney(total, party.currencyCode)}</div>
        {sharedBy && <div className="share-card-by">from {sharedBy}</div>}
      </div>

      {party.people.length > 0 && (
        <>
          <span className="label" style={{ marginTop: 15 }}>
            Who&rsquo;s in it
          </span>
          <div className="picker">
            {party.people.map((p, i) => (
              <span className="pick" key={p.id} style={{ ['--person-h' as string]: String(hueForIndex(i)) }}>
                <Avatar name={p.name} hue={hueForIndex(i)} size="xs" />
                {p.name || 'Unnamed'}
              </span>
            ))}
          </div>
        </>
      )}

      <p className="hint" style={{ marginTop: 15, display: 'flex', gap: 8 }}>
        <span style={{ flexShrink: 0, marginTop: 1 }}>
          <Inbox size={14} />
        </span>
        <span>
          <b>Open it</b> puts this on your workbench — whatever you were working on is saved to
          history first. <b>Save to history</b> files it away without disturbing anything.
        </span>
      </p>
    </Sheet>
  );
}
