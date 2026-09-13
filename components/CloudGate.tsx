'use client';

import { useState } from 'react';
import type { CloudStatus } from '@/lib/cloud/useCloud';
import { Party as PartyIcon, Plus, Users, Warn } from './Icons';

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

/**
 * What you see before there is anywhere to put your data: sign in, then either
 * start a Group or join one. Staying local is always an option — the app has never
 * needed an account and still does not.
 */
export function CloudGate({
  status,
  error,
  onSignIn,
  onStartGroup,
  onJoinGroup,
  onStayLocal,
  onSignOut,
}: {
  status: CloudStatus;
  error: string | null;
  onSignIn: () => void;
  onStartGroup: (name: string) => void;
  onJoinGroup: (code: string) => void;
  onStayLocal: () => void;
  onSignOut: () => void;
}) {
  const [groupName, setGroupName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);

  const signedOut = status === 'signed-out';

  return (
    <div className="gate">
      <div className="gate-card">
        <span className="gate-mark">
          <PartyIcon size={26} />
        </span>

        <h1 className="gate-title">
          Bros<span>Payday</span>
        </h1>

        {signedOut ? (
          <>
            <p className="gate-lede">
              Sign in and your events follow you to any phone or laptop, and the people in your
              Group see them too.
            </p>

            <button type="button" className="btn google block" onClick={onSignIn}>
              <GoogleMark />
              Continue with Google
            </button>

            <button type="button" className="btn ghost block" onClick={onStayLocal} style={{ marginTop: 9 }}>
              Keep it on this device only
            </button>

            <p className="hint gate-note">
              Staying local works exactly as before — nothing is uploaded, and you can still send
              someone a link. You can sign in later without losing any of it.
            </p>
          </>
        ) : (
          <>
            <p className="gate-lede">
              One more step — a Group is the people you split bills with. Everyone in it sees the same
              events.
            </p>

            <div className="gate-block">
              <span className="label">Start a new Group</span>
              <div className="add-person">
                <input
                  className="field"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && groupName.trim()) {
                      setBusy(true);
                      onStartGroup(groupName.trim());
                    }
                  }}
                  placeholder="The bros, Flat 3, Office lunch…"
                  aria-label="New Group name"
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="btn primary"
                  disabled={!groupName.trim() || busy}
                  onClick={() => {
                    setBusy(true);
                    onStartGroup(groupName.trim());
                  }}
                >
                  <Plus size={18} />
                  <span className="sr">Create Group</span>
                </button>
              </div>
            </div>

            <div className="gate-or">or</div>

            <div className="gate-block">
              <span className="label">Join one with a code</span>
              <div className="add-person">
                <input
                  className="field code-field"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && joinCode.trim()) {
                      setBusy(true);
                      onJoinGroup(joinCode.trim());
                    }
                  }}
                  placeholder="ABC123"
                  maxLength={6}
                  aria-label="Group join code"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="btn"
                  disabled={joinCode.trim().length < 4 || busy}
                  onClick={() => {
                    setBusy(true);
                    onJoinGroup(joinCode.trim());
                  }}
                >
                  <Users size={18} />
                  <span className="sr">Join Group</span>
                </button>
              </div>
            </div>

            <button type="button" className="btn ghost block" onClick={onSignOut} style={{ marginTop: 16 }}>
              Sign out
            </button>
          </>
        )}

        {error && (
          <p className="gate-error">
            <Warn size={14} />
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

export function CloudLoading({ label = 'Loading your events…' }: { label?: string }) {
  return (
    <div className="gate">
      <div className="gate-card">
        <span className="gate-mark spin">
          <PartyIcon size={26} />
        </span>
        <p className="gate-lede" style={{ marginBottom: 0 }}>
          {label}
        </p>
      </div>
    </div>
  );
}
