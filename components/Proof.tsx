'use client';

import { useState } from 'react';
import type { Person } from '@/lib/types';
import type { SplitResult } from '@/lib/split';
import { formatMoney } from '@/lib/format';
import { Avatar } from './Avatar';
import { Check, Chevron, Warn } from './Icons';

export function Proof({
  result,
  people,
  currencyCode,
  hueOf,
}: {
  result: SplitResult;
  people: Person[];
  currencyCode: string;
  hueOf: (id: string) => number;
}) {
  const [open, setOpen] = useState(false);
  const money = (v: number) => formatMoney(v, currencyCode);
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? '?';

  const settled = { ...result.net };
  for (const t of result.transfers) {
    settled[t.fromId] += t.amount;
    settled[t.toId] -= t.amount;
  }

  return (
    <section className="card">
      <button
        type="button"
        className="disclosure"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={result.balanced ? 'pill pos' : 'pill neg'}>
          {result.balanced ? <Check size={13} /> : <Warn size={13} />}
          {result.balanced ? 'Balanced' : 'Check inputs'}
        </span>
        <span style={{ fontSize: 14.5, fontWeight: 650 }}>Show the proof</span>
        <Chevron className="chev" />
      </button>

      {open && (
        <div className="card-body" style={{ paddingTop: 4 }}>
          <p className="hint" style={{ marginBottom: 16 }}>
            Every number below is derived, never guessed. Your share of an expense is what you
            consumed; your balance is what you paid minus what you consumed. The payments move money
            from negative balances to positive ones until every balance is zero.
          </p>

          {/* ── 1 ─────────────────────────────────────────────── */}
          <div className="proof-step">
            <div className="step-head">
              <span className="step-num">1</span>
              <span className="step-title">How each expense was divided</span>
            </div>
            <p className="step-note">
              Amounts are split to the smallest unit. When a division isn&rsquo;t clean, the leftover
              goes to whoever&rsquo;s remainder was largest — so the parts always add back to the
              exact bill.
            </p>

            {result.breakdowns.length === 0 ? (
              <div className="empty">No expenses to divide yet.</div>
            ) : (
              <div className="math-list">
                {result.breakdowns.map((b) => (
                  <div className="math-row" key={b.item.id}>
                    <div className="math-top">
                      <span className="math-name">{b.item.name || 'Untitled expense'}</span>
                      <span className="math-paid num">
                        {b.payer ? `${b.payer.name} paid ${money(b.item.amount)}` : 'no payer'}
                      </span>
                    </div>
                    <div className="math-eq">
                      {b.bearers.length === 0 ? (
                        <span style={{ color: 'var(--neg)' }}>Nobody is sharing this yet.</span>
                      ) : b.isTreat ? (
                        <>
                          {money(b.item.amount)} carried entirely by{' '}
                          <b>{b.bearers[0].name}</b> — a treat or a payback, not a split.
                        </>
                      ) : b.even ? (
                        <>
                          {money(b.item.amount)} ÷ {b.bearers.length}{' '}
                          {b.bearers.length === 1 ? 'person' : 'people'} (
                          {b.bearers.map((p) => p.name).join(', ')}) ={' '}
                          <b>{money(b.evenShare)} each</b>
                        </>
                      ) : (
                        b.bearers.map((p, i) => (
                          <span key={p.id}>
                            {i > 0 && ' · '}
                            {p.name} <b>{money(b.perPerson[p.id] ?? 0)}</b>
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── 2 ─────────────────────────────────────────────── */}
          {result.breakdowns.length > 0 && people.length > 0 && (
            <div className="proof-step">
              <div className="step-head">
                <span className="step-num">2</span>
                <span className="step-title">Everyone&rsquo;s share, expense by expense</span>
              </div>
              <p className="step-note">
                Read across for one person&rsquo;s total cost. Read down a column and it adds up to
                that expense exactly — that&rsquo;s the bottom row.
              </p>

              <div className="scroller">
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Person</th>
                      {result.breakdowns.map((b) => (
                        <th key={b.item.id} title={b.item.name}>
                          {b.item.name || 'Untitled'}
                        </th>
                      ))}
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <span className="cellname">
                            <Avatar name={p.name} hue={hueOf(p.id)} size="xs" />
                            {p.name || 'Unnamed'}
                          </span>
                        </td>
                        {result.breakdowns.map((b) => {
                          const v = b.perPerson[p.id] ?? 0;
                          return (
                            <td key={b.item.id} className={v === 0 ? 'zero' : undefined}>
                              {v === 0 ? '–' : money(v)}
                            </td>
                          );
                        })}
                        <td className="strong">{money(result.owed[p.id] ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Bill</td>
                      {result.breakdowns.map((b) => (
                        <td key={b.item.id}>{money(b.item.amount)}</td>
                      ))}
                      <td>{money(result.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* ── 3 ─────────────────────────────────────────────── */}
          {people.length > 0 && (
            <div className="proof-step">
              <div className="step-head">
                <span className="step-num">3</span>
                <span className="step-title">Paid versus owed</span>
              </div>
              <p className="step-note">
                Balance = what you put in minus what you used. Positive means the group owes you;
                negative means you owe the group.
              </p>

              <div className="scroller">
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th>Share</th>
                      <th>Paid</th>
                      <th>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((p) => {
                      const net = result.net[p.id] ?? 0;
                      return (
                        <tr key={p.id}>
                          <td>
                            <span className="cellname">
                              <Avatar name={p.name} hue={hueOf(p.id)} size="xs" />
                              {p.name || 'Unnamed'}
                            </span>
                          </td>
                          <td className="strong">{money(result.owed[p.id] ?? 0)}</td>
                          <td>{money(result.paid[p.id] ?? 0)}</td>
                          <td className={net > 0 ? 'pos strong' : net < 0 ? 'neg strong' : 'zero'}>
                            {net === 0 ? money(0) : formatMoney(net, currencyCode, { sign: true })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      <td>{money(result.totalOwed)}</td>
                      <td>{money(result.total)}</td>
                      <td>{money(0)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* ── 4 ─────────────────────────────────────────────── */}
          {result.transfers.length > 0 && (
            <div className="proof-step">
              <div className="step-head">
                <span className="step-num">4</span>
                <span className="step-title">Settling up</span>
              </div>
              <p className="step-note">
                The biggest debt is matched against the biggest credit, over and over. That keeps the
                number of transfers as low as possible — never more than one less than the number of
                people.
              </p>

              <div className="math-list" style={{ marginBottom: 12 }}>
                {result.transfers.map((t, i) => (
                  <div className="math-row" key={i}>
                    <div className="math-eq">
                      <b>{nameOf(t.fromId)}</b> owes {money(-(result.net[t.fromId] ?? 0))} in total →
                      sends <b>{money(t.amount)}</b> to {nameOf(t.toId)}
                    </div>
                  </div>
                ))}
              </div>

              <p className="step-note" style={{ margin: '0 0 8px 30px' }}>
                Applying those payments to every balance:
              </p>
              <div className="replay">
                {people.map((p) => (
                  <span className="replay-chip" key={p.id}>
                    <Avatar name={p.name} hue={hueOf(p.id)} size="xs" />
                    {p.name || 'Unnamed'}
                    <span className={settled[p.id] === 0 ? 'zeroed' : 'neg'}>
                      {settled[p.id] === 0 ? '0 ✓' : money(settled[p.id])}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ── checks ────────────────────────────────────────── */}
          <div className="proof-step">
            <div className="step-head">
              <span className="step-num">✓</span>
              <span className="step-title">Automatic checks</span>
            </div>
            <p className="step-note">
              These run on every change. If any of them ever fails, don&rsquo;t trust the numbers.
            </p>
            <div className="check-list">
              {result.checks.map((c) => (
                <div className={`check${c.ok ? '' : ' fail'}`} key={c.label}>
                  <span className="check-icon">{c.ok ? <Check size={15} /> : <Warn size={15} />}</span>
                  <span>
                    <span className="check-label">{c.label}</span>
                    <span className="check-detail">{c.detail}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
