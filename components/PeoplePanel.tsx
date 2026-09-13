'use client';

import { useState } from 'react';
import type { Person } from '@/lib/types';
import { Avatar } from './Avatar';
import { Plus, Users, X } from './Icons';

export function PeoplePanel({
  people,
  hueOf,
  usageOf,
  onAdd,
  onRename,
  onRemove,
}: {
  people: Person[];
  hueOf: (id: string) => number;
  usageOf: (id: string) => number;
  onAdd: (names: string[]) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
}) {
  const [draft, setDraft] = useState('');

  /** One field, many names: "Q, M, F" adds three people at once. */
  const commit = () => {
    const names = draft
      .split(/[,\n]/)
      .map((n) => n.trim())
      .filter(Boolean);
    if (names.length === 0) return;
    onAdd(names);
    setDraft('');
  };

  const tryRemove = (p: Person) => {
    const uses = usageOf(p.id);
    if (uses > 0) {
      const ok = window.confirm(
        `${p.name || 'This person'} appears in ${uses} expense${uses === 1 ? '' : 's'}.\n\n` +
          'Removing them will take them off those expenses and re-split the amounts. Continue?',
      );
      if (!ok) return;
    }
    onRemove(p.id);
  };

  return (
    <section className="card">
      <div className="card-head">
        <Users />
        <h2 className="card-title">Who&rsquo;s in</h2>
        <span className="pill">{people.length}</span>
      </div>

      <div className="card-body">
        {people.length > 0 && (
          <div className="people-grid">
            {people.map((p) => (
              <span className="person-chip" key={p.id}>
                <Avatar name={p.name} hue={hueOf(p.id)} />
                <input
                  className="pname"
                  value={p.name}
                  onChange={(e) => onRename(p.id, e.target.value)}
                  style={{ width: `${Math.min(12, Math.max(2, p.name.length + 0.5))}ch` }}
                  aria-label={`Name of ${p.name || 'person'}`}
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="icon-btn sm bare"
                  onClick={() => tryRemove(p)}
                  aria-label={`Remove ${p.name || 'person'}`}
                >
                  <X size={14} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="add-person">
          <input
            className="field"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              }
            }}
            onBlur={commit}
            placeholder={people.length === 0 ? 'Q, M, F, B, Y' : 'Add a name…'}
            aria-label="Add people"
            autoComplete="off"
            enterKeyHint="done"
          />
          <button type="button" className="btn" onClick={commit} disabled={!draft.trim()}>
            <Plus size={18} />
            <span className="sr">Add person</span>
          </button>
        </div>

        {people.length === 0 && (
          <p className="hint" style={{ marginTop: 9 }}>
            Tip — type several names separated by commas to add them all at once.
          </p>
        )}
      </div>
    </section>
  );
}
