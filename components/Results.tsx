'use client';

import { useState } from 'react';
import type { Person } from '@/lib/types';
import type { SplitResult } from '@/lib/split';
import { formatMoney } from '@/lib/format';
import { Avatar } from './Avatar';
import { Arrow, Check, Copy, Scale, Warn } from './Icons';

const sig = (t: { fromId: string; toId: string; amount: number }) =>
  `${t.fromId}>${t.toId}:${t.amount}`;

export function Results({
  result,
  people,
  currencyCode,
  hueOf,
  onCopy,
}: {
  result: SplitResult;
  people: Person[];
  currencyCode: string;
  hueOf: (id: string) => number;
  onCopy: () => void;
}) {
  /** Keyed by transfer signature, so ticks fall away the moment the numbers change. */
  const [done, setDone] = useState<string[]>([]);
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? '?';
  const money = (v: number) => formatMoney(v, currencyCode);

  const perHead = people.length > 0 ? Math.round(result.total / people.length) : 0;

  return (
    <>
      <dl className="totals">
        <div>
          <dt>Total spent</dt>
          <dd className="num">{money(result.total)}</dd>
        </div>
        <div>
          <dt>People</dt>
          <dd className="num">{people.length}</dd>
        </div>
        <div>
          <dt>Average each</dt>
          <dd className="num">{money(perHead)}</dd>
        </div>
      </dl>

      {result.problems.length > 0 && (
        <section className="card">
          <div className="card-head">
            <span style={{ color: 'var(--neg)', display: 'grid' }}>
              <Warn size={18} />
            </span>
            <h2 className="card-title">Needs attention</h2>
          </div>
          <div className="card-body">
            <div className="check-list">
              {result.problems.map((p, i) => (
                <div className="check fail" key={i}>
                  <span className="check-icon">
                    <Warn size={15} />
                  </span>
                  <span className="check-label">{p}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <Arrow size={18} />
          <h2 className="card-title">Who pays whom</h2>
          {result.transfers.length > 0 && (
            <button type="button" className="btn sm ghost" onClick={onCopy} style={{ marginLeft: 'auto' }}>
              <Copy size={15} />
              Copy
            </button>
          )}
        </div>

        <div className="card-body">
          {result.transfers.length === 0 ? (
            <div className="empty">
              <strong>Nothing to settle</strong>
              {result.total === 0 ? 'Add an expense to get started.' : 'Everyone is already square.'}
            </div>
          ) : (
            <>
              <div className="settle-list">
                {result.transfers.map((t) => {
                  const key = sig(t);
                  const isDone = done.includes(key);
                  return (
                    <button
                      type="button"
                      key={key}
                      className={`settle-row${isDone ? ' done' : ''}`}
                      onClick={() =>
                        setDone((prev) =>
                          prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
                        )
                      }
                      aria-pressed={isDone}
                    >
                      <span className="tick">
                        <Check size={13} />
                      </span>
                      <span className="settle-who">
                        <Avatar name={nameOf(t.fromId)} hue={hueOf(t.fromId)} size="xs" />
                        <span className="nm">{nameOf(t.fromId)}</span>
                        <span className="settle-arrow">
                          <Arrow size={16} />
                        </span>
                        <Avatar name={nameOf(t.toId)} hue={hueOf(t.toId)} size="xs" />
                        <span className="nm">{nameOf(t.toId)}</span>
                      </span>
                      <span className="settle-amount num">{money(t.amount)}</span>
                    </button>
                  );
                })}
              </div>
              <p className="hint" style={{ marginTop: 10 }}>
                {result.transfers.length} payment{result.transfers.length === 1 ? '' : 's'} clears
                everything. Tap one once it&rsquo;s been sent.
              </p>
            </>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <Scale size={18} />
          <h2 className="card-title">Everyone&rsquo;s balance</h2>
        </div>
        <div className="card-body">
          {people.length === 0 ? (
            <div className="empty">
              <strong>No one here yet</strong>
              Add people and expenses to see the split.
            </div>
          ) : (
            <div className="bal-list">
              {people.map((p) => {
                const net = result.net[p.id] ?? 0;
                const tone = net > 0 ? 'pos' : net < 0 ? 'neg' : 'zero';
                return (
                  <div className="bal-row" key={p.id}>
                    <Avatar name={p.name} hue={hueOf(p.id)} />
                    <span className="bal-main">
                      <span className="bal-name">{p.name || 'Unnamed'}</span>
                      <span className="bal-settle">
                        <span className={`bal-net num ${tone}`}>
                          {net === 0 ? money(0) : formatMoney(net, currencyCode, { sign: true })}
                        </span>
                        <span className="bal-tag">
                          {net > 0 ? 'gets back' : net < 0 ? 'owes' : 'settled'}
                        </span>
                      </span>
                    </span>
                    <span className="bal-right">
                      <span className="bal-share num">
                        Share {money(result.owed[p.id] ?? 0)}
                      </span>
                      <span className="bal-paid num">
                        Paid {money(result.paid[p.id] ?? 0)}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
