'use client';

import { useState } from 'react';
import type { Party, Preset } from '@/lib/types';
import { currencyOf } from '@/lib/types';
import { Sheet } from './Sheet';
import { Bookmark, Plus, Trash } from './Icons';

export function PresetSheet({
  presets,
  party,
  onApply,
  onSave,
  onDelete,
  onRename,
  onClose,
}: {
  presets: Preset[];
  party: Party;
  onApply: (id: string) => void;
  onSave: (name: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(party.title.trim());

  const canSave = party.people.length > 0;

  const commit = () => {
    const name = draft.trim();
    if (!canSave || !name) return;
    onSave(name);
    setDraft('');
  };

  return (
    <Sheet title="Presets" onClose={onClose}>
      <p className="hint" style={{ marginBottom: 13 }}>
        A preset is your usual crew saved under a name. Tap one and everybody is added at once —
        handy when every visit starts with a blank sheet.
      </p>

      {presets.length === 0 ? (
        <div className="empty">
          <strong>No presets yet</strong>
          Add the people for a party, then save them below as a preset you can reuse.
        </div>
      ) : (
        <div className="row-list">
          {presets.map((p) => (
            <div className="row-card" key={p.id}>
              <button
                type="button"
                className="row-open"
                onClick={() => onApply(p.id)}
                aria-label={`Apply preset ${p.name}`}
              >
                <span className="row-main">
                  <input
                    className="row-name-input"
                    value={p.name}
                    onChange={(e) => onRename(p.id, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Name of preset ${p.name}`}
                    spellCheck={false}
                  />
                  <span className="row-sub">
                    {p.people.join(', ') || 'no one yet'}
                    {p.itemNames.length > 0 && ` · ${p.itemNames.length} usual expenses`}
                  </span>
                </span>
                <span className="pill">{currencyOf(p.currencyCode).symbol}</span>
              </button>

              <button
                type="button"
                className="icon-btn sm bare"
                onClick={() => {
                  if (window.confirm(`Delete the preset “${p.name}”?`)) onDelete(p.id);
                }}
                aria-label={`Delete preset ${p.name}`}
              >
                <Trash size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="divider" />

      <label className="label" htmlFor="preset-name">
        Save this party as a preset
      </label>

      {canSave ? (
        <>
          <div className="add-person">
            <input
              id="preset-name"
              className="field"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commit();
                }
              }}
              placeholder="Name it — “Bros”, “Office lunch”…"
              autoComplete="off"
              enterKeyHint="done"
            />
            <button type="button" className="btn primary" onClick={commit} disabled={!draft.trim()}>
              <Plus size={18} />
              <span className="sr">Save preset</span>
            </button>
          </div>
          <p className="hint" style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <span style={{ flexShrink: 0, marginTop: 1 }}>
              <Bookmark size={14} />
            </span>
            Saves {party.people.map((p) => p.name).join(', ')}
            {party.items.length > 0 && ` and ${party.items.length} expense names`}. Amounts are
            never stored in a preset.
          </p>
        </>
      ) : (
        <div className="empty">
          <strong>Add some people first</strong>
          There&rsquo;s nothing to save into a preset yet.
        </div>
      )}
    </Sheet>
  );
}
