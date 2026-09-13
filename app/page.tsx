'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EventState, Item } from '@/lib/types';
import { CURRENCIES, currencyOf } from '@/lib/types';
import { computeSplit } from '@/lib/split';
import { formatMoney, uid } from '@/lib/format';
import { hueForIndex } from '@/lib/colors';
import { blankState, exampleState } from '@/lib/example';
import { decodeState, encodeState, loadLocal, saveLocal } from '@/lib/share';
import { PeoplePanel } from '@/components/PeoplePanel';
import { ExpenseList } from '@/components/ExpenseList';
import { ExpenseSheet } from '@/components/ExpenseSheet';
import { Results } from '@/components/Results';
import { Proof } from '@/components/Proof';
import { Copy, Dots, Link, Party, Plus, Sparkle, Trash } from '@/components/Icons';

type SheetState = { draft: Item; isNew: boolean } | null;

export default function Page() {
  const [state, setState] = useState<EventState>(blankState);
  const [view, setView] = useState<'setup' | 'results'>('setup');
  const [sheet, setSheet] = useState<SheetState>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [isSample, setIsSample] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const didLoad = useRef(false);

  /* ── load: shared link first, then this device, then a sample ── */
  useEffect(() => {
    // A ref guard, not just the empty dep array: React's dev-mode double-invoke would
    // otherwise re-read storage after the first save and clobber what we just restored.
    if (didLoad.current) return;
    didLoad.current = true;

    const hash = window.location.hash;
    const shared = hash.startsWith('#s=') ? decodeState(hash.slice(3)) : null;

    if (shared) {
      setState(shared);
      history.replaceState(null, '', window.location.pathname + window.location.search);
      setToast('Loaded from shared link');
    } else {
      const local = loadLocal();
      if (local) {
        setState(local);
      } else {
        setState(exampleState());
        setIsSample(true);
      }
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) saveLocal(state);
  }, [state, loaded]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  /* ── derived ─────────────────────────────────────────────────── */
  const result = useMemo(() => computeSplit(state), [state]);
  const cur = currencyOf(state.currencyCode);

  const hues = useMemo(() => {
    const map: Record<string, number> = {};
    state.people.forEach((p, i) => {
      map[p.id] = hueForIndex(i);
    });
    return map;
  }, [state.people]);

  const hueOf = useCallback((id: string) => hues[id] ?? 210, [hues]);

  const usageOf = useCallback(
    (id: string) =>
      state.items.filter((i) => i.payerId === id || i.bearerIds.includes(id)).length,
    [state.items],
  );

  /* ── mutations ───────────────────────────────────────────────── */
  const edit = useCallback((fn: (prev: EventState) => EventState) => {
    setIsSample(false);
    setState(fn);
  }, []);

  const addPeople = (names: string[]) =>
    edit((prev) => ({
      ...prev,
      people: [...prev.people, ...names.map((name) => ({ id: uid('p'), name }))],
    }));

  const renamePerson = (id: string, name: string) =>
    edit((prev) => ({
      ...prev,
      people: prev.people.map((p) => (p.id === id ? { ...p, name } : p)),
    }));

  const removePerson = (id: string) =>
    edit((prev) => ({
      ...prev,
      people: prev.people.filter((p) => p.id !== id),
      items: prev.items.map((item) => {
        const { [id]: _dropped, ...weights } = item.weights ?? {};
        return {
          ...item,
          payerId: item.payerId === id ? null : item.payerId,
          bearerIds: item.bearerIds.filter((b) => b !== id),
          weights,
        };
      }),
    }));

  const openNewExpense = () => {
    const lastPayer = state.items.length > 0 ? state.items[state.items.length - 1].payerId : null;
    const payerId =
      lastPayer && state.people.some((p) => p.id === lastPayer)
        ? lastPayer
        : (state.people[0]?.id ?? null);

    setSheet({
      isNew: true,
      draft: {
        id: uid('i'),
        name: '',
        amount: 0,
        payerId,
        bearerIds: state.people.map((p) => p.id),
        weights: {},
      },
    });
  };

  const openExpense = (id: string) => {
    const item = state.items.find((i) => i.id === id);
    if (item) setSheet({ draft: item, isNew: false });
  };

  const saveExpense = (item: Item) => {
    edit((prev) => ({
      ...prev,
      items: prev.items.some((i) => i.id === item.id)
        ? prev.items.map((i) => (i.id === item.id ? item : i))
        : [...prev.items, item],
    }));
    setSheet(null);
  };

  const deleteExpense = () => {
    if (!sheet) return;
    const id = sheet.draft.id;
    edit((prev) => ({ ...prev, items: prev.items.filter((i) => i.id !== id) }));
    setSheet(null);
  };

  /* ── sharing ─────────────────────────────────────────────────── */
  const write = async (text: string, okMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setToast(okMessage);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setToast(okMessage);
      } catch {
        setToast('Copy failed — select the text manually');
      }
      document.body.removeChild(ta);
    }
  };

  const summaryText = () => {
    const money = (v: number) => formatMoney(v, state.currencyCode);
    const nameOf = (id: string) => state.people.find((p) => p.id === id)?.name ?? '?';
    const lines: string[] = [];

    lines.push(`${state.title} — ${money(result.total)} total`);
    lines.push('');
    lines.push('WHO PAYS WHOM');
    if (result.transfers.length === 0) {
      lines.push('Everyone is square.');
    } else {
      for (const t of result.transfers) {
        lines.push(`${nameOf(t.fromId)} → ${nameOf(t.toId)}  ${money(t.amount)}`);
      }
    }
    lines.push('');
    lines.push('EACH PERSON');
    for (const p of state.people) {
      const net = result.net[p.id] ?? 0;
      const tag = net > 0 ? `gets back ${money(net)}` : net < 0 ? `owes ${money(-net)}` : 'settled';
      lines.push(`${p.name}: cost ${money(result.owed[p.id] ?? 0)}, paid ${money(result.paid[p.id] ?? 0)} → ${tag}`);
    }
    lines.push('');
    lines.push('EXPENSES');
    for (const b of result.breakdowns) {
      const who = b.bearers.map((x) => x.name).join(', ');
      lines.push(
        `${b.item.name}: ${money(b.item.amount)} paid by ${b.payer?.name ?? '?'} — split between ${who}`,
      );
    }
    return lines.join('\n');
  };

  const copySummary = () => write(summaryText(), 'Summary copied');

  const copyLink = () => {
    const url = `${window.location.origin}${window.location.pathname}#s=${encodeState(state)}`;
    return write(url, 'Share link copied');
  };

  const loadSample = () => {
    setState(exampleState());
    setIsSample(true);
    setMenuOpen(false);
    setToast('Sample party loaded');
  };

  const clearAll = () => {
    if (!window.confirm('Clear this party and start fresh? This cannot be undone.')) return;
    setState(blankState());
    setIsSample(false);
    setMenuOpen(false);
  };

  /* ── render ──────────────────────────────────────────────────── */
  return (
    <div className="shell" data-view={view}>
      <header className="topbar">
        <div className="topbar-row">
          <span className="brand">
            <span className="brand-mark">
              <Party size={17} />
            </span>
            <span className="brand-name">
              Bros<span>Payday</span>
            </span>
          </span>

          <input
            className="title-input"
            value={state.title}
            onChange={(e) => edit((prev) => ({ ...prev, title: e.target.value }))}
            aria-label="Party name"
            placeholder="Party name"
          />

          <span className="menu-wrap">
            <button
              type="button"
              className="icon-btn"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="More options"
              aria-expanded={menuOpen}
            >
              <Dots />
            </button>

            {menuOpen && (
              <>
                <span className="menu-scrim" onClick={() => setMenuOpen(false)} />
                <span className="menu" role="menu">
                  <span
                    className="row-between"
                    style={{ padding: '4px 10px 8px', fontSize: 13, color: 'var(--text-dim)' }}
                  >
                    Currency
                    <select
                      className="cur-select"
                      value={state.currencyCode}
                      onChange={(e) =>
                        edit((prev) => ({ ...prev, currencyCode: e.target.value }))
                      }
                      aria-label="Currency"
                    >
                      {CURRENCIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.symbol} {c.code}
                        </option>
                      ))}
                    </select>
                  </span>
                  <span className="sep" />
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      void copySummary();
                    }}
                  >
                    <Copy /> Copy summary for chat
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      void copyLink();
                    }}
                  >
                    <Link /> Copy share link
                  </button>
                  <span className="sep" />
                  <button type="button" onClick={loadSample}>
                    <Sparkle /> Load sample party
                  </button>
                  <button type="button" className="danger" onClick={clearAll}>
                    <Trash /> Start fresh
                  </button>
                </span>
              </>
            )}
          </span>
        </div>
      </header>

      {isSample && (
        <div className="sample-bar">
          <span>Showing a sample party so you can see how it works.</span>
          <button type="button" className="btn sm" onClick={clearAll}>
            Start fresh
          </button>
        </div>
      )}

      <nav className="switch" role="tablist" aria-label="Sections">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'setup'}
          onClick={() => setView('setup')}
        >
          Setup
          <span className="count">{state.items.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'results'}
          onClick={() => setView('results')}
        >
          Result
          <span className="count">{result.transfers.length}</span>
        </button>
      </nav>

      <main className="columns">
        <div className="col-setup">
          <PeoplePanel
            people={state.people}
            hueOf={hueOf}
            usageOf={usageOf}
            onAdd={addPeople}
            onRename={renamePerson}
            onRemove={removePerson}
          />
          <ExpenseList
            items={state.items}
            people={state.people}
            currencyCode={state.currencyCode}
            hueOf={hueOf}
            onOpen={openExpense}
            onAdd={openNewExpense}
            canAdd={state.people.length > 0}
          />
        </div>

        <div className="col-results">
          <Results
            result={result}
            people={state.people}
            currencyCode={state.currencyCode}
            hueOf={hueOf}
            onCopy={copySummary}
          />
          <Proof
            result={result}
            people={state.people}
            currencyCode={state.currencyCode}
            hueOf={hueOf}
          />
        </div>
      </main>

      <div className="dock">
        <div className="dock-inner">
          {view === 'setup' ? (
            <button
              type="button"
              className="btn primary block"
              onClick={openNewExpense}
              disabled={state.people.length === 0}
            >
              <Plus />
              Add expense
            </button>
          ) : (
            <button
              type="button"
              className="btn primary block"
              onClick={copySummary}
              disabled={state.items.length === 0}
            >
              <Copy />
              Copy summary for chat
            </button>
          )}
        </div>
      </div>

      {sheet && (
        <ExpenseSheet
          draft={sheet.draft}
          isNew={sheet.isNew}
          people={state.people}
          currencyCode={state.currencyCode}
          hueOf={hueOf}
          onSave={saveExpense}
          onDelete={deleteExpense}
          onClose={() => setSheet(null)}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      <p
        className="hint"
        style={{ textAlign: 'center', marginTop: 22, paddingBottom: 6 }}
      >
        Saved on this device only · amounts in {cur.code}
      </p>
    </div>
  );
}
