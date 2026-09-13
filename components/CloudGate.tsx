'use client';

import { Party as PartyIcon, Warn } from './Icons';

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
 * The one screen before the app: sign in, or say you would rather not. There is
 * deliberately nothing else here — no workspace to name, no code to enter. Signing
 * in creates somewhere for your events to live without asking.
 */
export function CloudGate({
  error,
  onSignIn,
  onStayLocal,
}: {
  error: string | null;
  onSignIn: () => void;
  onStayLocal: () => void;
}) {
  return (
    <div className="gate">
      <div className="gate-card">
        <span className="gate-mark">
          <PartyIcon size={26} />
        </span>

        <h1 className="gate-title">
          Bros<span>Payday</span>
        </h1>

        <p className="gate-lede">
          Sign in and your events follow you to any phone or laptop — and you can let the people
          you split with see them too.
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
