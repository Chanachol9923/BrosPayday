'use client';

import type { Item, Person } from '@/lib/types';
import { formatMoney } from '@/lib/format';
import { Avatar, AvatarStack } from './Avatar';
import { Camera, Plus, Receipt, Warn } from './Icons';

export function ExpenseList({
  items,
  people,
  currencyCode,
  hueOf,
  onOpen,
  onAdd,
  canAdd,
  suggestions,
  photoCountFor,
}: {
  items: Item[];
  people: Person[];
  currencyCode: string;
  hueOf: (id: string) => number;
  onOpen: (id: string) => void;
  onAdd: (name?: string) => void;
  canAdd: boolean;
  /** Usual expense names from an applied preset, offered as one-tap starters. */
  suggestions: string[];
  photoCountFor: (expenseId: string) => number;
}) {
  const nameOf = (id: string | null) => people.find((p) => p.id === id)?.name ?? '';
  const total = items.reduce((a, i) => a + i.amount, 0);

  return (
    <section className="card">
      <div className="card-head">
        <Receipt />
        <h2 className="card-title">Expenses</h2>
        {items.length > 0 && <span className="pill accent">{formatMoney(total, currencyCode)}</span>}
      </div>

      <div className="card-body">
        {items.length === 0 ? (
          <div className="empty">
            <strong>{canAdd ? 'No expenses yet' : 'Add people first'}</strong>
            {canAdd
              ? 'Add what was bought, who paid, and who shared it.'
              : 'BrosPayday needs at least one person before you can log a spend.'}
          </div>
        ) : (
          <div className="exp-list">
            {items.map((item) => {
              const bearers = item.bearerIds
                .map((id) => people.find((p) => p.id === id))
                .filter((p): p is Person => !!p);
              const broken = !item.payerId || bearers.length === 0 || item.amount <= 0;
              const payerName = nameOf(item.payerId);

              return (
                <button
                  type="button"
                  key={item.id}
                  className={`exp-row${broken ? ' bad' : ''}`}
                  onClick={() => onOpen(item.id)}
                >
                  {item.payerId ? (
                    <Avatar name={payerName} hue={hueOf(item.payerId)} />
                  ) : (
                    <span className="icon-btn sm" style={{ color: 'var(--neg)' }}>
                      <Warn size={15} />
                    </span>
                  )}

                  <span className="exp-main">
                    <span className="exp-name">{item.name || 'Untitled expense'}</span>
                    <span className="exp-meta">
                      <span className="trunc">
                        {item.payerId ? `${payerName} paid` : 'No payer set'}
                      </span>
                      <span className="dot">·</span>
                      <span className="trunc">
                        {bearers.length === 0
                          ? 'nobody sharing'
                          : bearers.length === people.length
                            ? 'everyone'
                            : `${bearers.length} sharing`}
                      </span>
                      {photoCountFor(item.id) > 0 && (
                        <>
                          <span className="dot">·</span>
                          <span className="exp-photos">
                            <Camera size={11} />
                            {photoCountFor(item.id)}
                          </span>
                        </>
                      )}
                    </span>
                  </span>

                  <AvatarStack
                    names={bearers.map((b) => b.name)}
                    hues={bearers.map((b) => hueOf(b.id))}
                  />

                  <span className="exp-amount num">{formatMoney(item.amount, currencyCode)}</span>
                </button>
              );
            })}
          </div>
        )}

        {canAdd && suggestions.length > 0 && (
          <div className="preset-strip" style={{ marginTop: 12 }}>
            <span className="preset-strip-label">Usual for this crew</span>
            <span className="picker">
              {suggestions.map((name) => (
                <button
                  type="button"
                  key={name}
                  className="preset-chip"
                  onClick={() => onAdd(name)}
                >
                  <Plus size={13} />
                  {name}
                </button>
              ))}
            </span>
          </div>
        )}

        {/* Hidden on phones, where the sticky dock already carries this action. */}
        <button
          type="button"
          className="btn primary block add-inline"
          onClick={() => onAdd()}
          disabled={!canAdd}
        >
          <Plus />
          Add expense
        </button>
      </div>
    </section>
  );
}
