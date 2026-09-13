'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Item, Person } from '@/lib/types';
import { currencyOf } from '@/lib/types';
import { allocate } from '@/lib/split';
import { amountToInput, formatMoney, parseAmount } from '@/lib/format';
import { Avatar } from './Avatar';
import { Trash, X } from './Icons';

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
  const [uneven, setUneven] = useState(
    Object.values(draft.weights ?? {}).some((w) => w !== 1),
  );

  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.body.classList.add('is-locked');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    if (isNew) nameRef.current?.focus();
    return () => {
      document.body.classList.remove('is-locked');
      window.removeEventListener('keydown', onKey);
    };
  }, [isNew, onClose]);

  const amount = parseAmount(amountText, cur.decimals) ?? 0;
  const ordered = useMemo(
    () => people.filter((p) => bearerIds.includes(p.id)),
    [people, bearerIds],
  );
  const weightList = ordered.map((p) => (uneven ? weights[p.id] ?? 1 : 1));
  const parts = allocate(amount, weightList);

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
          : null;

  const save = () => {
    if (problem) return;
    const cleanWeights: Record<string, number> = {};
    if (uneven) {
      for (const p of ordered) {
        const w = weights[p.id] ?? 1;
        if (w !== 1) cleanWeights[p.id] = w;
      }
    }
    onSave({
      ...draft,
      name: name.trim() || 'Untitled expense',
      amount,
      payerId,
      bearerIds: ordered.map((p) => p.id),
      weights: cleanWeights,
    });
  };

  const even = parts.length > 0 && parts.every((v) => v === parts[0]);
  const treat = !!payerId && ordered.length === 1 && ordered[0].id !== payerId;

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-label={isNew ? 'New expense' : 'Edit expense'}>
        <div className="sheet-grip" />

        <div className="sheet-head">
          <span className="sheet-title">{isNew ? 'New expense' : 'Edit expense'}</span>
          <button type="button" className="icon-btn bare" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="sheet-body">
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
                  <div className="weights">
                    {ordered.map((p, i) => {
                      const w = weights[p.id] ?? 1;
                      return (
                        <div className="weight-row" key={p.id}>
                          <Avatar name={p.name} hue={hueOf(p.id)} size="xs" />
                          <span className="nm">{p.name || 'Unnamed'}</span>
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
                          <span className="amt">{formatMoney(parts[i] ?? 0, currencyCode)}</span>
                        </div>
                      );
                    })}
                  </div>
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
        </div>

        <div className="sheet-foot">
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
        </div>
      </div>
    </div>
  );
}
