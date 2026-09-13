'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Sheet } from './Sheet';
import type { Item, Person } from '@/lib/types';
import { currencyOf } from '@/lib/types';
import { shareOut } from '@/lib/split';
import { amountToInput, formatMoney, parseAmount } from '@/lib/format';
import { Avatar } from './Avatar';
import { Trash } from './Icons';

export function ExpenseSheet({
  draft,
  isNew,
  people,
  currencyCode,
  hueOf,
  onSave,
  onDelete,
  onClose,
}: {
  draft: Item;
  isNew: boolean;
  people: Person[];
  currencyCode: string;
  hueOf: (id: string) => number;
  onSave: (item: Item) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const cur = currencyOf(currencyCode);

  const [name, setName] = useState(draft.name);
  const [amountText, setAmountText] = useState(amountToInput(draft.amount, cur.decimals));
  const [payerId, setPayerId] = useState<string | null>(draft.payerId);
  const [bearerIds, setBearerIds] = useState<string[]>(draft.bearerIds);
  const [weights, setWeights] = useState<Record<string, number>>(draft.weights ?? {});
  /**
   * Held as text, not numbers: someone typing "2" on the way to "20" must not have
   * the field rewritten under them, and a half-typed "1." has to survive too.
   */
  const [extraText, setExtraText] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const [id, v] of Object.entries(draft.extras ?? {})) {
      if (v > 0) out[id] = amountToInput(v, currencyOf(currencyCode).decimals);
    }
    return out;
  });
  const [uneven, setUneven] = useState(
    Object.values(draft.weights ?? {}).some((w) => w !== 1) ||
      Object.values(draft.extras ?? {}).some((v) => v > 0),
  );

  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isNew) nameRef.current?.focus();
  }, [isNew]);

  const amount = parseAmount(amountText, cur.decimals) ?? 0;
  const ordered = useMemo(
    () => people.filter((p) => bearerIds.includes(p.id)),
    [people, bearerIds],
  );
  /** Whatever this person is down for on their own, as a clean integer. */
  const extraOf = (id: string) => {
    if (!uneven) return 0;
    const v = parseAmount(extraText[id] ?? '', cur.decimals);
    return v !== null && v > 0 ? v : 0;
  };

  // The same function the engine and the proof use, so what is previewed here is
  // what will actually be owed — there is no second implementation to drift.
  const { parts, extraTotal, rest } = shareOut(
    amount,
    ordered.map((p) => ({ weight: uneven ? weights[p.id] ?? 1 : 1, extra: extraOf(p.id) })),
  );

  const toggleBearer = (id: string) =>
    setBearerIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const setWeight = (id: string, next: number) =>
    setWeights((prev) => ({ ...prev, [id]: Math.min(20, Math.max(1, next)) }));

  const problem =
    amount <= 0
      ? 'Enter an amount above zero.'
      : !payerId
        ? 'Pick who actually paid.'
        : ordered.length === 0
          ? 'Pick at least one person to share this.'
          : extraTotal > amount
            ? `The amounts people had to themselves come to ${formatMoney(
                extraTotal,
                currencyCode,
              )} — more than the expense.`
            : null;

  const save = () => {
    if (problem) return;
    const cleanWeights: Record<string, number> = {};
    const cleanExtras: Record<string, number> = {};
    if (uneven) {
      // Only the people actually sharing it, and only values worth storing —
      // anything left behind by a person since unticked goes no further.
      for (const p of ordered) {
        const w = weights[p.id] ?? 1;
        if (w !== 1) cleanWeights[p.id] = w;
        const e = extraOf(p.id);
        if (e > 0) cleanExtras[p.id] = e;
      }
    }
    onSave({
      ...draft,
      name: name.trim() || 'Untitled expense',
      amount,
      payerId,
      bearerIds: ordered.map((p) => p.id),
      weights: cleanWeights,
      extras: cleanExtras,
    });
  };

  const even = parts.length > 0 && parts.every((v) => v === parts[0]);
  const treat = !!payerId && ordered.length === 1 && ordered[0].id !== payerId;

  return (
    <Sheet
      title={isNew ? 'New expense' : 'Edit expense'}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <button type="button" className="btn danger icon-only" onClick={onDelete} aria-label="Delete expense">
              <Trash />
            </button>
          )}
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={save} disabled={!!problem}>
            {isNew ? 'Add' : 'Save'}
          </button>
        </>
      }
    >
      <>
          <div className="form-group">
            <label className="label" htmlFor="exp-name">
              What was it?
            </label>
            <input
              id="exp-name"
              ref={nameRef}
              className="field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Pork, Makro run, karaoke…"
              autoComplete="off"
              enterKeyHint="next"
            />
          </div>

          <div className="form-group">
            <label className="label" htmlFor="exp-amount">
              How much?
            </label>
            <div className="amount-wrap">
              <span className="cur">{cur.symbol}</span>
              <input
                id="exp-amount"
                className="amount-input"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                placeholder="0"
                inputMode="decimal"
                autoComplete="off"
                enterKeyHint="done"
              />
            </div>
          </div>

          <div className="form-group">
            <label className="label">Who paid?</label>
            <div className="picker">
              {people.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  className="pick"
                  style={{ ['--person-h' as string]: String(hueOf(p.id)) }}
                  aria-pressed={payerId === p.id}
                  onClick={() => setPayerId(p.id)}
                >
                  <Avatar name={p.name} hue={hueOf(p.id)} size="xs" />
                  {p.name || 'Unnamed'}
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <div className="row-between" style={{ marginBottom: 7 }}>
              <span className="label" style={{ margin: 0 }}>
                Who shares it?
              </span>
              <span className="quick">
                <button type="button" onClick={() => setBearerIds(people.map((p) => p.id))}>
                  Everyone
                </button>
                <button type="button" onClick={() => setBearerIds([])}>
                  None
                </button>
              </span>
            </div>

            <div className="picker">
              {people.map((p) => {
                const on = bearerIds.includes(p.id);
                const w = weights[p.id] ?? 1;
                return (
                  <button
                    type="button"
                    key={p.id}
                    className="pick"
                    style={{ ['--person-h' as string]: String(hueOf(p.id)) }}
                    aria-pressed={on}
                    onClick={() => toggleBearer(p.id)}
                  >
                    <Avatar name={p.name} hue={hueOf(p.id)} size="xs" />
                    {p.name || 'Unnamed'}
                    {on && uneven && w !== 1 && <span className="w">×{w}</span>}
                    {on && uneven && extraOf(p.id) > 0 && (
                      <span className="w own">+{formatMoney(extraOf(p.id), currencyCode)}</span>
                    )}
                  </button>
                );
              })}
            </div>

            {ordered.length > 1 && (
              <>
                <label
                  className="hint"
                  style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 11, cursor: 'pointer' }}
                >
                  <input
                    type="checkbox"
                    checked={uneven}
                    onChange={(e) => setUneven(e.target.checked)}
                    style={{ width: 17, height: 17, accentColor: 'var(--accent)' }}
                  />
                  Not an even split — someone had more
                </label>

                {uneven && (
                  <>
                    <p className="hint" style={{ margin: '9px 0 8px' }}>
                      Put anything one person had to themselves in their own box — it comes off the
                      top and goes straight to them. The rest is divided by shares, so ×2 still
                      means twice as much of what is left.
                    </p>

                    <div className="weights">
                      {ordered.map((p, i) => {
                        const w = weights[p.id] ?? 1;
                        const own = extraOf(p.id);
                        return (
                          <div className={`weight-row${own > 0 ? ' has-own' : ''}`} key={p.id}>
                            <Avatar name={p.name} hue={hueOf(p.id)} size="xs" />
                            <span className="nm">{p.name || 'Unnamed'}</span>
                            <span className="amt">{formatMoney(parts[i] ?? 0, currencyCode)}</span>

                            <span className="weight-ctl">
                              <span className="stepper">
                                <button
                                  type="button"
                                  className="icon-btn sm"
                                  onClick={() => setWeight(p.id, w - 1)}
                                  disabled={w <= 1}
                                  aria-label={`Fewer shares for ${p.name}`}
                                >
                                  &minus;
                                </button>
                                <span className="val">×{w}</span>
                                <button
                                  type="button"
                                  className="icon-btn sm"
                                  onClick={() => setWeight(p.id, w + 1)}
                                  aria-label={`More shares for ${p.name}`}
                                >
                                  +
                                </button>
                              </span>

                              <span className="own-field">
                                <span className="own-label">theirs alone</span>
                                <span className="cur">{cur.symbol}</span>
                                <input
                                  className="own-input num"
                                  value={extraText[p.id] ?? ''}
                                  placeholder="0"
                                  inputMode="decimal"
                                  autoComplete="off"
                                  enterKeyHint="done"
                                  onChange={(e) =>
                                    setExtraText((prev) => ({ ...prev, [p.id]: e.target.value }))
                                  }
                                  onFocus={(e) => e.currentTarget.select()}
                                  aria-label={`Amount only ${p.name} had, not shared`}
                                />
                              </span>
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {extraTotal > 0 && (
                      <p className={`split-maths${rest < 0 ? ' bad' : ''}`}>
                        {formatMoney(extraTotal, currencyCode)} goes straight to whoever had it
                        {rest >= 0 ? (
                          <>
                            {' · '}
                            <b>{formatMoney(rest, currencyCode)}</b> left to divide
                          </>
                        ) : (
                          <>
                            {' · '}
                            <b>{formatMoney(-rest, currencyCode)} over the expense</b>
                          </>
                        )}
                      </p>
                    )}
                  </>
                )}
              </>
            )}
          </div>

          <div className={`preview${problem ? ' warn' : ''}`}>
            <div className="preview-label">{problem ? 'Not ready yet' : 'This splits as'}</div>
            <div className="preview-text">
              {problem ? (
                problem
              ) : treat ? (
                <>
                  {people.find((p) => p.id === payerId)?.name} pays {formatMoney(amount, currencyCode)},
                  and <b>{ordered[0].name}</b> carries all of it &mdash; a treat or a payback.
                </>
              ) : even ? (
                <>
                  {formatMoney(amount, currencyCode)} ÷ {ordered.length}{' '}
                  {ordered.length === 1 ? 'person' : 'people'} ={' '}
                  <b>{formatMoney(parts[0], currencyCode)} each</b>
                </>
              ) : (
                ordered.map((p, i) => (
                  <span key={p.id}>
                    {i > 0 && ' · '}
                    {p.name} <b>{formatMoney(parts[i], currencyCode)}</b>
                  </span>
                ))
              )}
            </div>
          </div>
      </>
    </Sheet>
  );
}
