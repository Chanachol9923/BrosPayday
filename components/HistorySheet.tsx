'use client';

import { useMemo, useState } from 'react';
import type { Party } from '@/lib/types';
import { formatMoney } from '@/lib/format';
import { partyLabel, relativeDate } from '@/lib/store';
import { Sheet } from './Sheet';
import { Clock, Trash } from './Icons';

export function HistorySheet({
  parties,
  onOpen,
  onDelete,
  onClose,
}: {
  parties: Party[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return parties;
    return parties.filter(
      (p) =>
        partyLabel(p).toLowerCase().includes(q) ||
        p.date.includes(q) ||
        p.people.some((person) => person.name.toLowerCase().includes(q)),
    );
  }, [parties, query]);

  return (
    <Sheet title="History" onClose={onClose}>
      {parties.length === 0 ? (
        <div className="empty">
          <strong>Nothing saved yet</strong>
          Events land here automatically when you next open the app — or use “Save &amp; start
          new” once you&rsquo;re done with one.
        </div>
      ) : (
        <>
          {parties.length > 4 && (
            <input
              className="field"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, date or who was there…"
              aria-label="Search history"
              style={{ marginBottom: 12 }}
            />
          )}

          {filtered.length === 0 ? (
            <div className="empty">
              <strong>No match</strong>
              Nothing here for “{query}”.
            </div>
          ) : (
            <div className="row-list">
              {filtered.map((p) => {
                const total = p.items.reduce((a, i) => a + i.amount, 0);
                return (
                  <div className="row-card" key={p.id}>
                    <button
                      type="button"
                      className="row-open"
                      onClick={() => onOpen(p.id)}
                      aria-label={`Open ${partyLabel(p)}`}
                    >
                      <span className="row-main">
                        <span className="row-name">{partyLabel(p)}</span>
                        <span className="row-sub">
                          {relativeDate(p.date)} · {p.people.length}{' '}
                          {p.people.length === 1 ? 'person' : 'people'} · {p.items.length}{' '}
                          {p.items.length === 1 ? 'expense' : 'expenses'}
                        </span>
                      </span>
                      <span className="row-amount num">{formatMoney(total, p.currencyCode)}</span>
                    </button>

                    <button
                      type="button"
                      className="icon-btn sm bare"
                      onClick={() => {
                        if (window.confirm(`Delete “${partyLabel(p)}” for good?`)) onDelete(p.id);
                      }}
                      aria-label={`Delete ${partyLabel(p)}`}
                    >
                      <Trash size={15} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <p className="hint" style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <span style={{ flexShrink: 0, marginTop: 1 }}>
              <Clock size={14} />
            </span>
            Opening one puts it back on the workbench — your current event is saved here first, so
            nothing is lost either way.
          </p>
        </>
      )}
    </Sheet>
  );
}
