'use client';

import { useEffect, useState } from 'react';
import type { CloudGroup } from '@/lib/cloud/api';
import { listMembers } from '@/lib/cloud/api';
import { hueForIndex } from '@/lib/colors';
import { Avatar } from './Avatar';
import { Sheet } from './Sheet';
import { Check, Copy, Swap, Users } from './Icons';

/**
 * Who you are, and who else can see your events.
 *
 * There is no workspace to choose here. Signing in makes one, and the only reason
 * to think about it again is to let somebody in — so that is all this offers.
 */
export function AccountSheet({
  userName,
  userEmail,
  spaces,
  activeId,
  onSwitch,
  onJoin,
  onSignOut,
  onCopy,
  onClose,
}: {
  userName: string;
  userEmail: string;
  /** Usually one: your own. More once you have joined somebody else's. */
  spaces: CloudGroup[];
  activeId: string | null;
  onSwitch: (id: string) => void;
  onJoin: (code: string) => void;
  onSignOut: () => void;
  onCopy: (text: string, message: string) => void;
  onClose: () => void;
}) {
  const [members, setMembers] = useState<{ id: string; name: string; avatar: string | null }[]>([]);
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);

  const active = spaces.find((s) => s.id === activeId) ?? null;

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
    <Sheet title="You" onClose={onClose}>
      <div className="account-head">
        <Avatar name={userName || '?'} hue={hueForIndex(0)} size="lg" />
        <span className="row-main">
          <span className="row-name">{userName || 'Signed in'}</span>
          <span className="row-sub">{userEmail}</span>
        </span>
      </div>

      <div className="divider" />

      {active && (
        <>
          <span className="label">Let someone see your events</span>
          <div className="invite-card">
            <div className="invite-code num">{active.joinCode}</div>
            <div className="invite-actions">
              <button type="button" className="btn sm" onClick={() => onCopy(active.joinCode, 'Code copied')}>
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
            They sign in with Google and land in your events, able to add what they bought. Only
            share it with people you want editing your numbers.
          </p>

          {members.length > 1 && (
            <>
              <span className="label" style={{ marginTop: 15 }}>
                Can see your events ({members.length})
              </span>
              <div className="picker">
                {members.map((m, i) => (
                  <span className="pick" key={m.id} style={{ ['--person-h' as string]: String(hueForIndex(i)) }}>
                    <Avatar name={m.name || '?'} hue={hueForIndex(i)} size="xs" />
                    {m.name || 'Someone'}
                  </span>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {spaces.length > 1 && (
        <>
          <div className="divider" />
          <span className="label">Whose events you are looking at</span>
          <div className="row-list">
            {spaces.map((space, i) => {
              const isActive = space.id === activeId;
              return (
                <div className={`row-card${isActive ? ' active' : ''}`} key={space.id}>
                  <Avatar name={space.name} hue={hueForIndex(i)} />
                  <span className="row-main">
                    <span className="row-name">{space.name}</span>
                    <span className="row-sub num">code {space.joinCode}</span>
                  </span>
                  {isActive ? (
                    <span className="pill pos">
                      <Check size={12} />
                      Active
                    </span>
                  ) : (
                    <button type="button" className="btn sm" onClick={() => onSwitch(space.id)}>
                      <Swap size={14} />
                      Open
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="divider" />

      {joining ? (
        <>
          <span className="label">Someone gave you a code</span>
          <div className="add-person">
            <input
              className="field code-field"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && code.trim().length >= 4) onJoin(code.trim());
              }}
              placeholder="ABC123"
              maxLength={6}
              aria-label="Invite code"
              autoComplete="off"
              autoFocus
            />
            <button
              type="button"
              className="btn primary"
              disabled={code.trim().length < 4}
              onClick={() => onJoin(code.trim())}
            >
              <Users size={18} />
              <span className="sr">Join</span>
            </button>
          </div>
        </>
      ) : (
        <button type="button" className="btn ghost block" onClick={() => setJoining(true)}>
          <Users size={16} />
          Join someone with a code
        </button>
      )}

      <button type="button" className="btn ghost block" style={{ marginTop: 9 }} onClick={onSignOut}>
        Sign out
      </button>
    </Sheet>
  );
}
