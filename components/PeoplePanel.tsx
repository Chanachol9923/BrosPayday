'use client';

import { useState } from 'react';
import type { Person, Preset } from '@/lib/types';
import { Avatar } from './Avatar';
import { Bookmark, Plus, Qr, Users, X } from './Icons';

export function PeoplePanel({
  people,
  presets,
  hueOf,
  usageOf,
  onAdd,
  onRename,
  onRemove,
  onApplyPreset,
  onManagePresets,
  onOpenMember,
  hasPayment,
  readOnly = false,
}: {
  people: Person[];
  presets: Preset[];
  hueOf: (id: string) => number;
  usageOf: (id: string) => number;
  onOpenMember: (id: string) => void;
  hasPayment: (id: string) => boolean;
  onAdd: (names: string[]) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
  onApplyPreset: (id: string) => void;
  onManagePresets: () => void;
  readOnly?: boolean;
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
        {!readOnly && (
          <button
            type="button"
            className="btn sm ghost"
            onClick={onManagePresets}
            style={{ marginLeft: 'auto' }}
          >
            <Bookmark size={14} />
            Groups
          </button>
        )}
      </div>

      <div className="card-body">
        {!readOnly && people.length === 0 && presets.length > 0 && (
          <div className="preset-strip">
            <span className="preset-strip-label">Start with</span>
            <span className="picker">
              {presets.map((preset) => (
                <button
                  type="button"
                  key={preset.id}
                  className="preset-chip"
                  onClick={() => onApplyPreset(preset.id)}
                >
                  <Bookmark size={13} />
                  {preset.name}
                  <span className="preset-count">{preset.people.length}</span>
                </button>
              ))}
            </span>
          </div>
        )}

        {people.length > 0 && (
          <div className="people-grid">
            {people.map((p) => (
              <span className="person-chip" key={p.id}>
                <button
                  type="button"
                  className="person-avatar"
                  onClick={() => onOpenMember(p.id)}
                  aria-label={`Settings for ${p.name || 'this member'}`}
                >
                  <Avatar name={p.name} hue={hueOf(p.id)} />
                  {hasPayment(p.id) && (
                    <span className="pay-dot" aria-label="has a payment QR">
                      <Qr size={9} />
                    </span>
                  )}
                </button>
                <input
                  className="pname"
                  value={p.name}
                  readOnly={readOnly}
                  onChange={(e) => onRename(p.id, e.target.value)}
                  style={{ width: `${Math.min(12, Math.max(2, p.name.length + 0.5))}ch` }}
                  aria-label={`Name of ${p.name || 'person'}`}
                  spellCheck={false}
                />
                {!readOnly && (
                  <button
                    type="button"
                    className="icon-btn sm bare"
                    onClick={() => tryRemove(p)}
                    aria-label={`Remove ${p.name || 'person'}`}
                  >
                    <X size={14} />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        {!readOnly && (
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
            placeholder={people.length === 0 ? 'Members (Ex. Q, M, F, B, Y)' : 'Add a name…'}
            aria-label="Add people"
            autoComplete="off"
            enterKeyHint="done"
          />
          <button type="button" className="btn" onClick={commit} disabled={!draft.trim()}>
            <Plus size={18} />
            <span className="sr">Add person</span>
          </button>
        </div>
        )}

        {!readOnly && people.length === 0 && (
          <p className="hint" style={{ marginTop: 9 }}>
            Tip — type several names separated by commas to add them all at once. Save the people you
            split with often as a Group and it&rsquo;s one tap next time.
          </p>
        )}
      </div>
    </section>
  );
}
