'use client';

import { useState } from 'react';
import type { Party, Profile } from '@/lib/types';
import { hueForIndex } from '@/lib/colors';
import { Avatar } from './Avatar';
import { Sheet } from './Sheet';
import { Check, Cloud, Plus, Swap, Trash } from './Icons';

export function ProfileSheet({
  profiles,
  activeId,
  history,
  current,
  onSwitch,
  onAdd,
  onRename,
  onDelete,
  onSignIn,
  onClose,
}: {
  profiles: Profile[];
  activeId: string;
  history: Record<string, Party[]>;
  current: Record<string, Party>;
  onSwitch: (id: string) => void;
  onAdd: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /** Absent when there is no cloud to sign in to, so the offer is never empty. */
  onSignIn?: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState('');

  const commit = () => {
    const name = draft.trim();
    if (!name) return;
    onAdd(name);
    setDraft('');
  };

  const tryDelete = (p: Profile) => {
    const parties = history[p.id]?.length ?? 0;
    const message =
      parties > 0
        ? `Delete “${p.name}” and their ${parties} saved ${parties === 1 ? 'event' : 'events'}? This cannot be undone.`
        : `Delete “${p.name}”?`;
    if (window.confirm(message)) onDelete(p.id);
  };

  return (
    <Sheet title="Who's using this?" onClose={onClose}>
      {onSignIn && (
        <>
          <div className="signin-offer">
            <span className="signin-offer-text">
              <b>Only on this device.</b> Sign in and your parties follow you to any phone or
              laptop, and your Group sees them too. Nothing here is lost — it comes with you.
            </span>
            <button type="button" className="btn primary block" onClick={onSignIn}>
              <Cloud size={16} />
              Sign in to sync
            </button>
          </div>
          <div className="divider" />
        </>
      )}

      <p className="hint" style={{ marginBottom: 13 }}>
        Each person gets their own events, history and presets on this device. No password —
        it&rsquo;s just a way to keep separate tabs on the same phone or laptop.
      </p>

      <div className="row-list">
        {profiles.map((p, i) => {
          const isActive = p.id === activeId;
          const saved = history[p.id]?.length ?? 0;
          const live = current[p.id]?.items.length ?? 0;

          return (
            <div className={`row-card${isActive ? ' active' : ''}`} key={p.id}>
              <Avatar name={p.name} hue={hueForIndex(i)} />

              <span className="row-main">
                <input
                  className="row-name-input"
                  value={p.name}
                  onChange={(e) => onRename(p.id, e.target.value)}
                  aria-label={`Name of ${p.name}`}
                  spellCheck={false}
                />
                <span className="row-sub">
                  {saved} saved · {live} on the go
                </span>
              </span>

              {isActive ? (
                <span className="pill pos">
                  <Check size={12} />
                  Active
                </span>
              ) : (
                <button type="button" className="btn sm" onClick={() => onSwitch(p.id)}>
                  <Swap size={14} />
                  Switch
                </button>
              )}

              {profiles.length > 1 && (
                <button
                  type="button"
                  className="icon-btn sm bare"
                  onClick={() => tryDelete(p)}
                  aria-label={`Delete ${p.name}`}
                >
                  <Trash size={15} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="add-person" style={{ marginTop: 13 }}>
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
          placeholder="Add someone…"
          aria-label="New user name"
          autoComplete="off"
          enterKeyHint="done"
        />
        <button type="button" className="btn primary" onClick={commit} disabled={!draft.trim()}>
          <Plus size={18} />
          <span className="sr">Add user</span>
        </button>
      </div>
    </Sheet>
  );
}
