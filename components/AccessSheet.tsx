'use client';

import { useCallback, useEffect, useState } from 'react';
import type { EventPerson, LogEntry } from '@/lib/cloud/api';
import { listEventAccess, listEventLog, setEventBan } from '@/lib/cloud/api';
import { formatMoney } from '@/lib/format';
import { hueForIndex } from '@/lib/colors';
import { Avatar } from './Avatar';
import { Sheet } from './Sheet';
import { Check, Clock, Swap, Users, Warn, X } from './Icons';

/** "just now", "14 min ago", "yesterday 21:04", then a plain date. */
function whenLabel(ms: number): string {
  const diff = Date.now() - ms;
  const d = new Date(ms);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;

  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return time;

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `yesterday ${time}`;

  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${time}`;
}

/** The log stores what happened; this is how it reads. */
function describe(entry: LogEntry, currency: string): React.ReactNode {
  const what = <b>{entry.subject || 'something'}</b>;
  const money =
    entry.amount !== null ? <span className="log-amount num"> {formatMoney(entry.amount, currency)}</span> : null;

  switch (entry.action) {
    case 'created_event':
      return <>started this event</>;
    case 'renamed_event':
      return <>renamed it to {what}</>;
    case 'archived_event':
      return <>moved it to history</>;
    case 'added_expense':
      return (
        <>
          added {what}
          {money}
        </>
      );
    case 'changed_expense':
      return (
        <>
          changed {what}
          {money}
        </>
      );
    case 'removed_expense':
      return (
        <>
          removed {what}
          {money}
        </>
      );
    case 'added_person':
      return <>added {what} to the split</>;
    case 'renamed_person':
      return <>renamed someone to {what}</>;
    case 'removed_person':
      return <>took {what} off the split</>;
    case 'recorded_repayment':
      // The subject is already the pair, e.g. "M to Q".
      return entry.amount === 0 ? (
        <>cleared what had been paid back for {what}</>
      ) : (
        <>
          recorded {what} as paid{money}
        </>
      );
    case 'removed_member':
      return <>removed {what} from this event</>;
    case 'restored_member':
      return <>brought {what} back</>;
    default:
      return <>{entry.action.replace(/_/g, ' ')} {what}</>;
  }
}

export function AccessSheet({
  partyId,
  currencyCode,
  viewerId,
  onClose,
  onToast,
}: {
  partyId: string;
  currencyCode: string;
  viewerId: string | null;
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const [people, setPeople] = useState<EventPerson[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [access, entries] = await Promise.all([listEventAccess(partyId), listEventLog(partyId)]);
      setPeople(access);
      setLog(entries);
    } catch {
      onToast('Could not load who is on this event');
    } finally {
      setLoading(false);
    }
  }, [partyId, onToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const viewerIsOwner = people.some((p) => p.userId === viewerId && p.isOwner);

  const toggleBan = async (person: EventPerson) => {
    const removing = !person.isBanned;
    if (
      removing &&
      !window.confirm(
        `Remove ${person.name} from this event? They lose sight of it until you put them back.`,
      )
    ) {
      return;
    }

    setBusy(person.userId);
    try {
      await setEventBan(partyId, person.userId, removing);
      await load();
      onToast(removing ? `${person.name} removed` : `${person.name} is back`);
    } catch {
      onToast('That did not work — only whoever started the event can change this');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet title="On this event" onClose={onClose}>
      {loading ? (
        <p className="hint">Loading…</p>
      ) : (
        <>
          <span className="label">
            <Users size={13} /> Can see and edit ({people.filter((p) => !p.isBanned).length})
          </span>

          <div className="row-list">
            {people.map((person, i) => (
              <div className={`row-card${person.isBanned ? ' banned' : ''}`} key={person.userId}>
                <Avatar name={person.name} hue={hueForIndex(i)} />
                <span className="row-main">
                  <span className="row-name">
                    {person.name}
                    {person.userId === viewerId && <span className="row-you">you</span>}
                  </span>
                  <span className="row-sub">
                    {person.isOwner ? 'started this event' : person.isBanned ? 'removed' : 'can edit'}
                  </span>
                </span>

                {person.isOwner ? (
                  <span className="pill accent">
                    <Check size={12} />
                    Owner
                  </span>
                ) : viewerIsOwner ? (
                  <button
                    type="button"
                    className={person.isBanned ? 'btn sm' : 'btn sm danger'}
                    disabled={busy === person.userId}
                    onClick={() => void toggleBan(person)}
                  >
                    {person.isBanned ? <Swap size={13} /> : <X size={13} />}
                    {person.isBanned ? 'Put back' : 'Remove'}
                  </button>
                ) : person.isBanned ? (
                  <span className="pill neg">Removed</span>
                ) : null}
              </div>
            ))}
          </div>

          {!viewerIsOwner && (
            <p className="hint" style={{ marginTop: 9, display: 'flex', gap: 8 }}>
              <span style={{ flexShrink: 0, marginTop: 1 }}>
                <Warn size={13} />
              </span>
              Only whoever started this event can add or remove people, so one disagreement cannot
              turn into a race to remove each other.
            </p>
          )}

          <div className="divider" />

          <span className="label">
            <Clock size={13} /> What happened
          </span>

          {log.length === 0 ? (
            <p className="hint">Nothing yet.</p>
          ) : (
            <ol className="log-list">
              {log.map((entry) => (
                <li className="log-row" key={entry.id}>
                  <Avatar
                    name={entry.actorName}
                    hue={entry.actorId ? hueForIndex(people.findIndex((p) => p.userId === entry.actorId) + 1) : 210}
                    size="xs"
                  />
                  <span className="log-text">
                    <b className="log-actor">{entry.actorName}</b> {describe(entry, currencyCode)}
                  </span>
                  <span className="log-when">{whenLabel(entry.at)}</span>
                </li>
              ))}
            </ol>
          )}

          <p className="hint" style={{ marginTop: 11 }}>
            Everything is recorded, including edits made through an invite link — those carry a name
            too, since an invite link only works once the person using it has signed in.
          </p>
        </>
      )}
    </Sheet>
  );
}
