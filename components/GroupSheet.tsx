'use client';

import { useEffect, useState } from 'react';
import type { CloudGroup } from '@/lib/cloud/api';
import { listMembers } from '@/lib/cloud/api';
import { hueForIndex } from '@/lib/colors';
import { Avatar } from './Avatar';
import { Sheet } from './Sheet';
import { Check, Copy, Plus, Swap, Users } from './Icons';

export function GroupSheet({
  groups,
  activeId,
  userName,
  onSwitch,
  onRename,
  onCreate,
  onJoin,
  onSignOut,
  onCopy,
  onClose,
}: {
  groups: CloudGroup[];
  activeId: string | null;
  userName: string;
  onSwitch: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onCreate: (name: string) => void;
  onJoin: (code: string) => void;
  onSignOut: () => void;
  onCopy: (text: string, message: string) => void;
  onClose: () => void;
}) {
  const [members, setMembers] = useState<{ id: string; name: string; avatar: string | null }[]>([]);
  const [newGroup, setNewGroup] = useState('');
  const [code, setCode] = useState('');
  const [adding, setAdding] = useState(false);

  const active = groups.find((c) => c.id === activeId) ?? null;

  useEffect(() => {
    if (!activeId) return;
    let alive = true;
    listMembers(activeId)
      .then((found) => {
        if (alive) setMembers(found);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [activeId]);

  const inviteLink = active
    ? `${typeof window === 'undefined' ? '' : window.location.origin}/?group=${active.joinCode}`
    : '';

  return (
    <Sheet title="Your Group" onClose={onClose}>
      <p className="hint" style={{ marginBottom: 13 }}>
        Signed in as <b style={{ color: 'var(--text)' }}>{userName}</b>. A Group is the people you
        split with — everyone in it sees the same parties on any device.
      </p>

      {active && (
        <>
          <span className="label">Invite someone</span>
          <div className="invite-card">
            <div className="invite-code num">{active.joinCode}</div>
            <div className="invite-actions">
              <button
                type="button"
                className="btn sm"
                onClick={() => onCopy(active.joinCode, 'Code copied')}
              >
                <Copy size={14} />
                Code
              </button>
              <button
                type="button"
                className="btn sm primary"
                onClick={() => onCopy(inviteLink, 'Invite link copied')}
              >
                <Copy size={14} />
                Invite link
              </button>
            </div>
          </div>
          <p className="hint" style={{ marginTop: 8 }}>
            They sign in with Google, and the code puts them straight into this Group.
          </p>

          <div className="divider" />

          <span className="label">
            In this Group ({members.length})
          </span>
          <div className="picker" style={{ marginBottom: 4 }}>
            {members.map((m, i) => (
              <span className="pick" key={m.id} style={{ ['--person-h' as string]: String(hueForIndex(i)) }}>
                <Avatar name={m.name || '?'} hue={hueForIndex(i)} size="xs" />
                {m.name || 'Someone'}
              </span>
            ))}
          </div>
        </>
      )}

      <div className="divider" />

      <span className="label">Groups you are in</span>
      <div className="row-list">
        {groups.map((group, i) => {
          const isActive = group.id === activeId;
          return (
            <div className={`row-card${isActive ? ' active' : ''}`} key={group.id}>
              <Avatar name={group.name} hue={hueForIndex(i)} />
              <span className="row-main">
                <input
                  className="row-name-input"
                  value={group.name}
                  onChange={(e) => onRename(group.id, e.target.value)}
                  aria-label={`Name of ${group.name}`}
                />
                <span className="row-sub num">code {group.joinCode}</span>
              </span>
              {isActive ? (
                <span className="pill pos">
                  <Check size={12} />
                  Active
                </span>
              ) : (
                <button type="button" className="btn sm" onClick={() => onSwitch(group.id)}>
                  <Swap size={14} />
                  Switch
                </button>
              )}
            </div>
          );
        })}
      </div>

      {adding ? (
        <>
          <div className="divider" />
          <span className="label">Start another Group</span>
          <div className="add-person">
            <input
              className="field"
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
              placeholder="Group name"
              aria-label="New Group name"
              autoComplete="off"
            />
            <button
              type="button"
              className="btn primary"
              disabled={!newGroup.trim()}
              onClick={() => onCreate(newGroup.trim())}
            >
              <Plus size={18} />
              <span className="sr">Create</span>
            </button>
          </div>

          <span className="label" style={{ marginTop: 14 }}>
            Or join with a code
          </span>
          <div className="add-person">
            <input
              className="field code-field"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABC123"
              maxLength={6}
              aria-label="Group join code"
              autoComplete="off"
            />
            <button
              type="button"
              className="btn"
              disabled={code.trim().length < 4}
              onClick={() => onJoin(code.trim())}
            >
              <Users size={18} />
              <span className="sr">Join</span>
            </button>
          </div>
        </>
      ) : (
        <button type="button" className="btn ghost block" style={{ marginTop: 12 }} onClick={() => setAdding(true)}>
          <Plus size={16} />
          Start or join another Group
        </button>
      )}

      <div className="divider" />

      <button type="button" className="btn ghost block" onClick={onSignOut}>
        Sign out
      </button>
    </Sheet>
  );
}
