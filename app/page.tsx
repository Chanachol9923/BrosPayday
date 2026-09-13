'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Item, Party, Store } from '@/lib/types';
import { CURRENCIES, currencyOf } from '@/lib/types';
import { computeSplit } from '@/lib/split';
import { formatMoney, rescaleAmount, uid } from '@/lib/format';
import { hueForIndex } from '@/lib/colors';
import {
  addPreset,
  addProfile,
  applyPreset,
  archiveCurrent,
  deleteFromHistory,
  deletePreset,
  deleteProfile,
  isWorthKeeping,
  loadStore,
  newParty,
  partyLabel,
  placeholderStore,
  presetFromParty,
  relativeDate,
  renamePreset,
  renameProfile,
  reopenFromHistory,
  sampleParty,
  saveStore,
  saveToHistory,
  setCurrent,
  startSession,
  switchProfile,
  updateCurrent,
} from '@/lib/store';
import type { SharedParty } from '@/lib/share';
import { buildShareUrl, readShareHash } from '@/lib/share';
import { PartyHeader } from '@/components/PartyHeader';
import { PeoplePanel } from '@/components/PeoplePanel';
import { ExpenseList } from '@/components/ExpenseList';
import { ExpenseSheet } from '@/components/ExpenseSheet';
import { Results } from '@/components/Results';
import { Proof } from '@/components/Proof';
import { ProfileSheet } from '@/components/ProfileSheet';
import { HistorySheet } from '@/components/HistorySheet';
import { PresetSheet } from '@/components/PresetSheet';
import { ShareSheet } from '@/components/ShareSheet';
import { ImportSheet } from '@/components/ImportSheet';
import { Avatar } from '@/components/Avatar';
import {
  Bookmark,
  Chevron,
  Clock,
  Copy,
  Dots,
  Party as PartyIcon,
  Plus,
  Share,
  Sparkle,
  Trash,
} from '@/components/Icons';

type SheetState = { draft: Item; isNew: boolean } | null;
type Modal = null | 'profiles' | 'history' | 'presets' | 'share';

export default function Page() {
  const [store, setStore] = useState<Store>(placeholderStore);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<'setup' | 'results'>('setup');
  const [sheet, setSheet] = useState<SheetState>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [incoming, setIncoming] = useState<SharedParty | null>(null);
  const [shareUrl, setShareUrl] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [isSample, setIsSample] = useState(false);
  const didLoad = useRef(false);

  /* ── boot ────────────────────────────────────────────────────── */
  useEffect(() => {
    // A ref guard, not just the empty dep array: React's dev-mode double-invoke
    // would otherwise run the archive-and-start-fresh step twice.
    if (didLoad.current) return;
    didLoad.current = true;

    const shared = readShareHash(window.location.hash);
    if (shared) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
      setIncoming(shared);
    }

    const { store: saved, firstRun } = loadStore();
    const pid = saved.activeProfileId;

    if (firstRun) {
      setStore(setCurrent(saved, pid, sampleParty()));
      setIsSample(true);
    } else {
      const { store: next, archived } = startSession(saved, pid);
      setStore(next);
      if (archived) setToast(`“${partyLabel(archived)}” saved to history`);
    }

    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) saveStore(store);
  }, [store, loaded]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  /* ── derived ─────────────────────────────────────────────────── */
  const profileId = store.activeProfileId;
  const profile = store.profiles.find((p) => p.id === profileId) ?? store.profiles[0];
  const profileIndex = Math.max(0, store.profiles.findIndex((p) => p.id === profileId));
  const party = store.current[profileId];
  const historyList = store.history[profileId] ?? [];
  const presets = store.presets[profileId] ?? [];

  const result = useMemo(() => computeSplit(party), [party]);
  const cur = currencyOf(party.currencyCode);

  const hues = useMemo(() => {
    const map: Record<string, number> = {};
    party.people.forEach((p, i) => {
      map[p.id] = hueForIndex(i);
    });
    return map;
  }, [party.people]);

  const hueOf = useCallback((id: string) => hues[id] ?? 210, [hues]);

  const usageOf = useCallback(
    (id: string) => party.items.filter((i) => i.payerId === id || i.bearerIds.includes(id)).length,
    [party.items],
  );

  /* ── party edits ─────────────────────────────────────────────── */
  const updateParty = useCallback((fn: (p: Party) => Party) => {
    setIsSample(false);
    setStore((prev) => updateCurrent(prev, prev.activeProfileId, fn));
  }, []);

  const addPeople = (names: string[]) =>
    updateParty((p) => ({
      ...p,
      people: [...p.people, ...names.map((name) => ({ id: uid('p'), name }))],
    }));

  const renamePerson = (id: string, name: string) =>
    updateParty((p) => ({
      ...p,
      people: p.people.map((x) => (x.id === id ? { ...x, name } : x)),
    }));

  const removePerson = (id: string) =>
    updateParty((p) => ({
      ...p,
      people: p.people.filter((x) => x.id !== id),
      items: p.items.map((item) => {
        const { [id]: _dropped, ...weights } = item.weights ?? {};
        return {
          ...item,
          payerId: item.payerId === id ? null : item.payerId,
          bearerIds: item.bearerIds.filter((b) => b !== id),
          weights,
        };
      }),
    }));

  /**
   * Amounts live in minor units, so moving between a 2-decimal currency and a
   * 0-decimal one has to rescale them — otherwise ฿400 would reappear as ¥40,000.
   */
  const changeCurrency = (code: string) =>
    updateParty((p) => {
      const from = currencyOf(p.currencyCode).decimals;
      const to = currencyOf(code).decimals;
      if (from === to) return { ...p, currencyCode: code };
      return {
        ...p,
        currencyCode: code,
        items: p.items.map((i) => ({ ...i, amount: rescaleAmount(i.amount, from, to) })),
      };
    });

  const openNewExpense = (presetName?: string) => {
    const lastPayer = party.items.length > 0 ? party.items[party.items.length - 1].payerId : null;
    const payerId =
      lastPayer && party.people.some((p) => p.id === lastPayer)
        ? lastPayer
        : (party.people[0]?.id ?? null);

    setSheet({
      isNew: true,
      draft: {
        id: uid('i'),
        name: presetName ?? '',
        amount: 0,
        payerId,
        bearerIds: party.people.map((p) => p.id),
        weights: {},
      },
    });
  };

  const openExpense = (id: string) => {
    const item = party.items.find((i) => i.id === id);
    if (item) setSheet({ draft: item, isNew: false });
  };

  const saveExpense = (item: Item) => {
    updateParty((p) => ({
      ...p,
      items: p.items.some((i) => i.id === item.id)
        ? p.items.map((i) => (i.id === item.id ? item : i))
        : [...p.items, item],
    }));
    setSuggestions((prev) => prev.filter((n) => n.toLowerCase() !== item.name.trim().toLowerCase()));
    setSheet(null);
  };

  const deleteExpense = () => {
    if (!sheet) return;
    const id = sheet.draft.id;
    updateParty((p) => ({ ...p, items: p.items.filter((i) => i.id !== id) }));
    setSheet(null);
  };

  /* ── profiles ────────────────────────────────────────────────── */
  const doSwitchProfile = (id: string) => {
    const switched = switchProfile(store, id);
    const { store: next, archived } = startSession(switched, id);
    setStore(next);
    setSuggestions([]);
    setIsSample(false);
    setModal(null);
    setToast(
      archived
        ? `“${partyLabel(archived)}” saved · switched user`
        : `Switched to ${next.profiles.find((p) => p.id === id)?.name ?? 'user'}`,
    );
  };

  const doAddProfile = (name: string) => {
    setStore(addProfile(store, name));
    setSuggestions([]);
    setIsSample(false);
    setModal(null);
    setToast(`${name} added`);
  };

  /* ── history ─────────────────────────────────────────────────── */
  const openFromHistory = (id: string) => {
    setStore(reopenFromHistory(store, profileId, id));
    setSuggestions([]);
    setIsSample(false);
    setModal(null);
    setView('setup');
    setToast('Back on the workbench');
  };

  const startNewParty = () => {
    const keeping = isWorthKeeping(party);
    setStore(archiveCurrent(store, profileId));
    setSuggestions([]);
    setIsSample(false);
    setMenuOpen(false);
    setView('setup');
    setToast(keeping ? 'Saved to history — fresh sheet ready' : 'Fresh sheet ready');
  };

  const discardParty = () => {
    if (!window.confirm('Delete this party without saving it to history?')) return;
    setStore(setCurrent(store, profileId, newParty(party.currencyCode)));
    setSuggestions([]);
    setIsSample(false);
    setMenuOpen(false);
    setView('setup');
  };

  /* ── presets ─────────────────────────────────────────────────── */
  const applyPresetById = (id: string) => {
    const preset = presets.find((p) => p.id === id);
    if (!preset) return;
    setStore(updateCurrent(store, profileId, (p) => applyPreset(p, preset)));
    setSuggestions(preset.itemNames);
    setIsSample(false);
    setModal(null);
    setToast(`${preset.name} — ${preset.people.length} people added`);
  };

  const savePreset = (name: string) => {
    setStore(addPreset(store, profileId, presetFromParty(party, name)));
    setToast(`Preset “${name}” saved`);
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
    const money = (v: number) => formatMoney(v, party.currencyCode);
    const nameOf = (id: string) => party.people.find((p) => p.id === id)?.name ?? '?';
    const lines: string[] = [];

    lines.push(`${partyLabel(party)} — ${relativeDate(party.date)}`);
    lines.push(`${money(result.total)} total`);
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
    for (const p of party.people) {
      const net = result.net[p.id] ?? 0;
      const tag = net > 0 ? `gets back ${money(net)}` : net < 0 ? `owes ${money(-net)}` : 'settled';
      lines.push(
        `${p.name}: cost ${money(result.owed[p.id] ?? 0)}, paid ${money(result.paid[p.id] ?? 0)} → ${tag}`,
      );
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

  const openShare = () => {
    setShareUrl(buildShareUrl(party, profile?.name));
    setMenuOpen(false);
    setModal('share');
  };

  /* ── importing a shared party ────────────────────────────────── */
  const openShared = () => {
    if (!incoming) return;
    let next = store;
    if (isWorthKeeping(party)) {
      next = saveToHistory(next, profileId, { ...party, updatedAt: Date.now() });
    }
    next = setCurrent(next, profileId, incoming.party);
    setStore(next);
    setIncoming(null);
    setSuggestions([]);
    setIsSample(false);
    setView('setup');
    setToast('Shared party opened');
  };

  const saveSharedOnly = () => {
    if (!incoming) return;
    setStore(saveToHistory(store, profileId, incoming.party));
    setIncoming(null);
    setToast('Saved to history');
  };

  const loadSample = () => {
    setStore(setCurrent(store, profileId, sampleParty()));
    setSuggestions([]);
    setIsSample(true);
    setMenuOpen(false);
    setView('setup');
    setToast('Sample party loaded');
  };

  /* ── render ──────────────────────────────────────────────────── */
  return (
    <div className="shell" data-view={view}>
      <header className="topbar">
        <div className="topbar-row">
          <span className="brand">
            <span className="brand-mark">
              <PartyIcon size={17} />
            </span>
            <span className="brand-name">
              Bros<span>Payday</span>
            </span>
          </span>

          <span className="topbar-spacer" />

          <button
            type="button"
            className="icon-btn"
            onClick={() => setModal('history')}
            aria-label={`History — ${historyList.length} saved`}
          >
            <Clock />
            {historyList.length > 0 && <span className="dot-badge" />}
          </button>

          <button
            type="button"
            className="profile-btn"
            onClick={() => setModal('profiles')}
            aria-label={`Signed in as ${profile?.name ?? 'user'} — switch user`}
          >
            <Avatar name={profile?.name ?? '?'} hue={hueForIndex(profileIndex)} size="xs" />
            <span className="profile-name">{profile?.name}</span>
            <Chevron size={14} />
          </button>

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
                      value={party.currencyCode}
                      onChange={(e) => changeCurrency(e.target.value)}
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
                  <button type="button" onClick={openShare}>
                    <Share /> Share this party
                  </button>
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
                      setModal('presets');
                    }}
                  >
                    <Bookmark /> Presets
                  </button>
                  <span className="sep" />
                  <button type="button" onClick={startNewParty}>
                    <Plus /> Save &amp; start new party
                  </button>
                  <button type="button" onClick={loadSample}>
                    <Sparkle /> Load sample party
                  </button>
                  <button type="button" className="danger" onClick={discardParty}>
                    <Trash /> Delete this party
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
          <button type="button" className="btn sm" onClick={discardParty}>
            Start fresh
          </button>
        </div>
      )}

      <PartyHeader
        title={party.title}
        date={party.date}
        onTitle={(v) => updateParty((p) => ({ ...p, title: v }))}
        onDate={(v) => updateParty((p) => ({ ...p, date: v }))}
      />

      <nav className="switch" role="tablist" aria-label="Sections">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'setup'}
          onClick={() => setView('setup')}
        >
          Setup
          <span className="count">{party.items.length}</span>
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
            people={party.people}
            presets={presets}
            hueOf={hueOf}
            usageOf={usageOf}
            onAdd={addPeople}
            onRename={renamePerson}
            onRemove={removePerson}
            onApplyPreset={applyPresetById}
            onManagePresets={() => setModal('presets')}
          />
          <ExpenseList
            items={party.items}
            people={party.people}
            currencyCode={party.currencyCode}
            hueOf={hueOf}
            onOpen={openExpense}
            onAdd={openNewExpense}
            canAdd={party.people.length > 0}
            suggestions={suggestions}
          />
        </div>

        <div className="col-results">
          <Results
            result={result}
            people={party.people}
            currencyCode={party.currencyCode}
            hueOf={hueOf}
            onCopy={copySummary}
          />
          <Proof
            result={result}
            people={party.people}
            currencyCode={party.currencyCode}
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
              onClick={() => openNewExpense()}
              disabled={party.people.length === 0}
            >
              <Plus />
              Add expense
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn"
                onClick={copySummary}
                disabled={party.items.length === 0}
              >
                <Copy />
                Copy
              </button>
              <button
                type="button"
                className="btn primary block"
                onClick={openShare}
                disabled={party.items.length === 0}
              >
                <Share />
                Share this party
              </button>
            </>
          )}
        </div>
      </div>

      {sheet && (
        <ExpenseSheet
          draft={sheet.draft}
          isNew={sheet.isNew}
          people={party.people}
          currencyCode={party.currencyCode}
          hueOf={hueOf}
          onSave={saveExpense}
          onDelete={deleteExpense}
          onClose={() => setSheet(null)}
        />
      )}

      {modal === 'profiles' && (
        <ProfileSheet
          profiles={store.profiles}
          activeId={profileId}
          history={store.history}
          current={store.current}
          onSwitch={doSwitchProfile}
          onAdd={doAddProfile}
          onRename={(id, name) => setStore((prev) => renameProfile(prev, id, name))}
          onDelete={(id) => setStore((prev) => deleteProfile(prev, id))}
          onClose={() => setModal(null)}
        />
      )}

      {modal === 'history' && (
        <HistorySheet
          parties={historyList}
          onOpen={openFromHistory}
          onDelete={(id) => setStore((prev) => deleteFromHistory(prev, profileId, id))}
          onClose={() => setModal(null)}
        />
      )}

      {modal === 'presets' && (
        <PresetSheet
          presets={presets}
          party={party}
          onApply={applyPresetById}
          onSave={savePreset}
          onDelete={(id) => setStore((prev) => deletePreset(prev, profileId, id))}
          onRename={(id, name) => setStore((prev) => renamePreset(prev, profileId, id, name))}
          onClose={() => setModal(null)}
        />
      )}

      {modal === 'share' && (
        <ShareSheet
          party={party}
          url={shareUrl}
          summary={summaryText()}
          sharedBy={profile?.name ?? 'a friend'}
          onCopyLink={() => write(shareUrl, 'Link copied')}
          onCopySummary={copySummary}
          onClose={() => setModal(null)}
        />
      )}

      {incoming && (
        <ImportSheet
          shared={incoming}
          onOpen={openShared}
          onSaveOnly={saveSharedOnly}
          onClose={() => setIncoming(null)}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      <p className="hint" style={{ textAlign: 'center', marginTop: 22, paddingBottom: 6 }}>
        Saved on this device only · {historyList.length} in history · amounts in {cur.code}
      </p>
    </div>
  );
}
