'use client';

import type { CloudGroup } from '@/lib/cloud/api';
import { hueForIndex } from '@/lib/colors';
import { Avatar } from './Avatar';
import { Sheet } from './Sheet';
import { Check, Swap } from './Icons';

/**
 * Who you are, and nothing else unless there is something to choose.
 *
 * Sharing lives on the event now — one code per event — so an account no longer
 * hands anyone the keys to everything at once.
 */
export function AccountSheet({
  userName,
  userEmail,
  spaces,
  activeId,
  onSwitch,
  onSignOut,
  onClose,
}: {
  userName: string;
  userEmail: string;
  /** Usually one: your own. More once you have joined somebody else's. */
  spaces: CloudGroup[];
  activeId: string | null;
  onSwitch: (id: string) => void;
  onSignOut: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="You" onClose={onClose}>
      <div className="account-head">
        <Avatar name={userName || '?'} hue={hueForIndex(0)} size="lg" />
        <span className="row-main">
          <span className="row-name">{userName || 'Signed in'}</span>
          <span className="row-sub">{userEmail}</span>
        </span>
      </div>

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

      <button type="button" className="btn ghost block" onClick={onSignOut}>
        Sign out
      </button>
    </Sheet>
  );
}
