'use client';

import { useState } from 'react';
import type { Payee, Person } from '@/lib/types';
import type { SplitResult } from '@/lib/split';
import { repaymentKey, repaymentView } from '@/lib/split';
import { currencyOf } from '@/lib/types';
import { amountToInput, formatMoney, parseAmount } from '@/lib/format';
import { Avatar } from './Avatar';
import { Arrow, Check, Copy, Qr, Scale, Warn } from './Icons';

/** Keyed on the numbers too, so a tick falls away the moment the split changes. */
export const transferKey = (t: { fromId: string; toId: string; amount: number }) =>
  `${t.fromId}>${t.toId}:${t.amount}`;

export function Results({
  result,
  people,
  currencyCode,
  hueOf,
  onCopy,
  repayments,
  onRepaid,
  payeeFor,
  onOpenPay,
  readOnly = false,
}: {
  result: SplitResult;
  people: Person[];
  currencyCode: string;
  hueOf: (id: string) => number;
  onCopy: () => void;
  /** How much of each suggested payment has already changed hands. */
  repayments: Record<string, number>;
  onRepaid: (fromId: string, toId: string, amountPaid: number) => void;
  payeeFor: (personId: string) => Payee | null;
  onOpenPay: (transfer: { fromId: string; toId: string; amount: number }) => void;
  readOnly?: boolean;
}) {
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
                {result.transfers.map((t) => (
                  <SettleRow
                    key={transferKey(t)}
                    transfer={t}
                    paid={repayments[repaymentKey(t.fromId, t.toId)] ?? 0}
                    currencyCode={currencyCode}
                    fromName={nameOf(t.fromId)}
                    toName={nameOf(t.toId)}
                    hueFrom={hueOf(t.fromId)}
                    hueTo={hueOf(t.toId)}
                    hasQr={!!payeeFor(t.toId)}
                    readOnly={readOnly}
                    onRepaid={onRepaid}
                    onOpenPay={onOpenPay}
                  />
                ))}
              </div>
              <p className="hint" style={{ marginTop: 10 }}>
                {result.transfers.length === 1
                  ? 'One payment clears everything.'
                  : `${result.transfers.length} payments clear everything.`}{' '}
                Type what has actually been handed over and each row keeps its own total; the
                circle fills the whole amount in at once.
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

/**
 * One suggested payment, plus a record of how much of it has actually happened.
 *
 * The repaid amount is an annotation, never an input to the split: typing here
 * changes what this row says is left, and nothing else. If it fed back into the
 * calculation, the list of who-pays-whom would rearrange itself under the fingers
 * of whoever was typing, and the proof would stop matching the receipts.
 */
function SettleRow({
  transfer,
  paid,
  currencyCode,
  fromName,
  toName,
  hueFrom,
  hueTo,
  hasQr,
  readOnly,
  onRepaid,
  onOpenPay,
}: {
  transfer: { fromId: string; toId: string; amount: number };
  paid: number;
  currencyCode: string;
  fromName: string;
  toName: string;
  hueFrom: number;
  hueTo: number;
  hasQr: boolean;
  readOnly: boolean;
  onRepaid: (fromId: string, toId: string, amountPaid: number) => void;
  onOpenPay: (transfer: { fromId: string; toId: string; amount: number }) => void;
}) {
  const cur = currencyOf(currencyCode);
  const money = (v: number) => formatMoney(v, currencyCode);

  const { paid: settledAmount, left, done } = repaymentView(transfer.amount, paid);

  /** Held only while the field has focus, so a half-typed "1." stays as typed. */
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? amountToInput(settledAmount, cur.decimals);

  const commit = (next: string) => {
    const parsed = next.trim() === '' ? 0 : parseAmount(next, cur.decimals);
    if (parsed === null) return; // not a number yet — leave the stored figure alone
    const clamped = Math.min(Math.max(parsed, 0), transfer.amount);
    if (clamped !== paid) onRepaid(transfer.fromId, transfer.toId, clamped);
  };

  return (
    <div className={`settle-row${done ? ' done' : ''}`}>
      <div className="settle-top">
        <button
          type="button"
          className="tick"
          onClick={() => onRepaid(transfer.fromId, transfer.toId, done ? 0 : transfer.amount)}
          disabled={readOnly}
          aria-pressed={done}
          aria-label={
            done
              ? `Mark ${fromName} to ${toName} as not paid`
              : `Mark ${fromName} to ${toName} as paid in full`
          }
        >
          <Check size={13} />
        </button>

        <button
          type="button"
          className="settle-body"
          onClick={() => onOpenPay(transfer)}
          aria-label={
            done ? `${fromName} to ${toName} is already paid` : `Pay ${toName} ${money(left)}`
          }
        >
          <span className="settle-who">
            <Avatar name={fromName} hue={hueFrom} size="xs" />
            <span className="nm">{fromName}</span>
            <span className="settle-arrow">
              <Arrow size={16} />
            </span>
            <Avatar name={toName} hue={hueTo} size="xs" />
            <span className="nm">{toName}</span>
          </span>
          {hasQr && (
            <span className="settle-qr" aria-label="has a payment QR">
              <Qr size={15} />
            </span>
          )}
          <span className="settle-amount num">
            {settledAmount > 0 && !done && <s className="settle-was">{money(transfer.amount)}</s>}
            {money(done ? transfer.amount : left)}
          </span>
        </button>
      </div>

      {readOnly ? (
        settledAmount > 0 && (
          <div className="settle-repaid">
            <span className="settle-repaid-label">Paid back</span>
            <span className="num">{money(settledAmount)}</span>
            <span className={`settle-left num${done ? ' clear' : ''}`}>
              {done ? 'all square' : `${money(left)} left`}
            </span>
          </div>
        )
      ) : (
        <div className="settle-repaid">
          <label className="settle-repaid-label" htmlFor={`repaid-${transfer.fromId}-${transfer.toId}`}>
            Paid back
          </label>
          <span className="repaid-wrap">
            <span className="cur">{cur.symbol}</span>
            <input
              id={`repaid-${transfer.fromId}-${transfer.toId}`}
              className="repaid-input num"
              value={text}
              placeholder="0"
              inputMode="decimal"
              autoComplete="off"
              enterKeyHint="done"
              onChange={(e) => {
                setDraft(e.target.value);
                // Commit as soon as it reads as a number rather than waiting for
                // blur: on a phone the field is often left by tapping elsewhere,
                // and a typed figure that vanishes is worse than no field at all.
                commit(e.target.value);
              }}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => {
                commit(e.target.value);
                setDraft(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              aria-label={`How much ${fromName} has already given ${toName}`}
            />
          </span>
          <span className={`settle-left num${done ? ' clear' : ''}`}>
            {done ? 'all square' : `${money(left)} left`}
          </span>
        </div>
      )}
    </div>
  );
}
