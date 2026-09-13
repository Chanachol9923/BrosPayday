'use client';

import { Calendar } from './Icons';

export function PartyHeader({
  title,
  date,
  onTitle,
  onDate,
  readOnly = false,
}: {
  title: string;
  date: string;
  onTitle: (v: string) => void;
  onDate: (v: string) => void;
  readOnly?: boolean;
}) {
  return (
    <section className="party-head">
      <input
        className="party-title"
        value={title}
        onChange={(e) => onTitle(e.target.value)}
        readOnly={readOnly}
        placeholder="Name this event"
        aria-label="Event name"
        autoComplete="off"
      />
      <label className="party-date">
        <Calendar size={16} />
        <input
          type="date"
          value={date}
          onChange={(e) => onDate(e.target.value)}
          readOnly={readOnly}
          disabled={readOnly}
          aria-label="Date of the event"
        />
      </label>
    </section>
  );
}
