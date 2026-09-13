'use client';

import { Calendar } from './Icons';

export function PartyHeader({
  title,
  date,
  onTitle,
  onDate,
}: {
  title: string;
  date: string;
  onTitle: (v: string) => void;
  onDate: (v: string) => void;
}) {
  return (
    <section className="party-head">
      <input
        className="party-title"
        value={title}
        onChange={(e) => onTitle(e.target.value)}
        placeholder="Name this party"
        aria-label="Party name"
        autoComplete="off"
      />
      <label className="party-date">
        <Calendar size={16} />
        <input
          type="date"
          value={date}
          onChange={(e) => onDate(e.target.value)}
          aria-label="Date of the party"
        />
      </label>
    </section>
  );
}
