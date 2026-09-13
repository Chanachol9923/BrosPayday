'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Item, Party, Payee, Store } from '@/lib/types';
import { CURRENCIES, currencyOf } from '@/lib/types';
import { computeSplit } from '@/lib/split';
import { formatMoney, rescaleAmount, uid } from '@/lib/format';
import { hueForIndex } from '@/lib/colors';
import {
  addPhotoMeta,
  addPreset,
  addProfile,
  applyPreset,
  archiveCurrent,
  deleteFromHistory,
  deletePreset,
  deleteProfile,
  hasPaymentDetails,
  isWorthKeeping,
  linkPhotoToExpense,
  loadStore,
  newParty,
  partyLabel,
  payeeFor as lookupPayee,
  photosForExpense,
  placeholderStore,
  presetFromParty,
  referencedPhotoIds,
  relativeDate,
  renamePreset,
  removePhotoMeta,
  renameProfile,
  reopenFromHistory,
  saveStore,
  saveToHistory,
  setCurrent,
  setPayee,
  startSession,
  switchProfile,
  updateCurrent,
} from '@/lib/store';
import type { SharedParty } from '@/lib/share';
import { buildShareUrl, readShareHash } from '@/lib/share';
import {
  QR_ENCODE,
  deletePhoto,
  deletePhotos,
  getPhotoBlob,
  savePhoto,
  setCloudPhotoFetcher,
  sweepOrphans,
} from '@/lib/photos';
import { cloudConfigured } from '@/lib/supabase/client';
import { useCloud } from '@/lib/cloud/useCloud';
import {
  crewPath,
  downloadPhoto,
  receiptPath,
  removePhoto as removePhoto_cloud,
  uploadPhoto,
} from '@/lib/cloud/photos';
import { CloudGate, CloudLoading } from '@/components/CloudGate';
import { CrewSheet } from '@/components/CrewSheet';
import { diffParty } from '@/lib/cloud/diff';
import type { ShareLink } from '@/lib/cloud/api';
import {
  applyOps,
  createShareLink,
  listShareLinks,
  readSharedParty,
  revokeShareLink,
  writeSharedParty,
} from '@/lib/cloud/api';
import { PartyHeader } from '@/components/PartyHeader';
import { PeoplePanel } from '@/components/PeoplePanel';
import { ExpenseList } from '@/components/ExpenseList';
import { ExpenseSheet } from '@/components/ExpenseSheet';
import { Results, transferKey } from '@/components/Results';
import { Proof } from '@/components/Proof';
import { ProfileSheet } from '@/components/ProfileSheet';
import { HistorySheet } from '@/components/HistorySheet';
import { PresetSheet } from '@/components/PresetSheet';
import { ShareSheet } from '@/components/ShareSheet';
import { ImportSheet } from '@/components/ImportSheet';
import { PhotoShelf } from '@/components/PhotoShelf';
import { PhotoViewer } from '@/components/PhotoViewer';
import { MemberSheet } from '@/components/MemberSheet';
import { PayQrSheet } from '@/components/PayQrSheet';
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
  Trash,
} from '@/components/Icons';

type SheetState = { draft: Item; isNew: boolean } | null;
type Modal = null | 'profiles' | 'history' | 'presets' | 'share';

const MODE_KEY = 'brospayday.mode';
const MIGRATED_KEY = 'brospayday.migrated';

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
  const [settled, setSettled] = useState<string[]>([]);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<{ fromId: string; toId: string; amount: number } | null>(null);
  const [photoIndex, setPhotoIndex] = useState<number | null>(null);
  const [photoBusy, setPhotoBusy] = useState(0);
  const [localOnly, setLocalOnly] = useState(false);
  /** Set when the page was opened with a share token rather than by a crew member. */
  const [shareMode, setShareMode] = useState<{ token: string; role: 'view' | 'edit' } | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [cloudLinks, setCloudLinks] = useState<ShareLink[]>([]);
  const sharedBase = useRef<Party | null>(null);
  const didLoad = useRef(false);

  const cloud = useCloud(store, setStore);
  /** Cloud is in charge of the data — the local store is not persisted in this mode. */
  const usingCloud = cloud.configured && !localOnly && !shareMode;
  /** A view link may look at everything and change nothing. */
  const readOnly = shareMode?.role === 'view';

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

    const token = new URLSearchParams(window.location.search).get('s');
    if (token && cloudConfigured) {
      setShareLoading(true);
      setLoaded(true);
      void readSharedParty(token)
        .then((found) => {
          if (!found) {
            setToast('That link is no longer valid');
            return;
          }
          setShareMode({ token, role: found.role });
          sharedBase.current = found.party;
          setStore((prev) => ({
            ...prev,
            current: { ...prev.current, [prev.activeProfileId]: found.party },
          }));
        })
        .finally(() => setShareLoading(false));
      return;
    }

    const chosenLocal = localStorage.getItem(MODE_KEY) === 'local';
    if (chosenLocal) setLocalOnly(true);

    if (cloudConfigured && !chosenLocal) {
      // useCloud pulls the crew's data; touching the local store here would
      // briefly show someone else's device state and then fight the sync.
      setLoaded(true);
      return;
    }

    // Nothing is seeded — a first visit and a later visit both begin on an
    // empty sheet, and whatever was open last time goes to history.
    const { store: saved } = loadStore();
    const { store: next, archived } = startSession(saved, saved.activeProfileId);
    setStore(next);
    if (archived) setToast(`“${partyLabel(archived)}” saved to history`);

    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded && !usingCloud && !shareMode) saveStore(store);
  }, [store, loaded, usingCloud, shareMode]);


  // Photos taken on someone else's phone are fetched on demand and then cached.
  useEffect(() => {
    if (!usingCloud || !party) {
      setCloudPhotoFetcher(null);
      return;
    }
    setCloudPhotoFetcher(async (photoId) => {
      const inParty = (party.photos ?? []).some((p) => p.id === photoId);
      const path = inParty
        ? receiptPath(party.id, photoId)
        : cloud.activeCrewId
          ? crewPath(cloud.activeCrewId, photoId)
          : null;
      return path ? downloadPhoto(path) : null;
    });
    return () => setCloudPhotoFetcher(null);
  });

  /**
   * Anything already on this device is offered up the first time a crew is joined.
   * It is a copy, not a move: the local data is left alone, so a failed upload or
   * a change of mind costs nothing.
   */
  useEffect(() => {
    if (!usingCloud || cloud.status !== 'ready' || !cloud.activeCrewId || !cloud.user) return;
    if (localStorage.getItem(MIGRATED_KEY)) return;

    const local = loadStore().store;
    const mine = local.profiles.flatMap((pr) => [
      local.current[pr.id],
      ...(local.history[pr.id] ?? []),
    ]);
    const worthMoving = mine.filter((pt) => pt && pt.items.length > 0) as Party[];

    localStorage.setItem(MIGRATED_KEY, 'asked');
    if (worthMoving.length === 0) return;

    const crewName = cloud.activeCrew?.name ?? 'this crew';
    const ok = window.confirm(
      `${worthMoving.length} ${worthMoving.length === 1 ? 'party is' : 'parties are'} saved on this device.

` +
        `Copy ${worthMoving.length === 1 ? 'it' : 'them'} into ${crewName}? The local copy is kept either way.`,
    );
    if (!ok) return;

    const ops = worthMoving.flatMap((pt) => diffParty(null, pt));
    applyOps(ops, {
      groupId: cloud.activeCrewId,
      userId: cloud.user.id,
      // everything brought over lands in history, not on the workbench
      archivedIds: new Set(worthMoving.map((pt) => pt.id)),
    })
      .then(() => setToast(`Moved ${worthMoving.length} into ${crewName}`))
      .catch(() => setToast('Could not copy those up — they are still on this device'));
  }, [usingCloud, cloud.status, cloud.activeCrewId, cloud.user, cloud.activeCrew]);

  // An invite link drops someone straight into the right crew.
  useEffect(() => {
    if (!usingCloud || cloud.status !== 'no-crew') return;
    const code = new URLSearchParams(window.location.search).get('crew');
    if (!code) return;
    history.replaceState(null, '', window.location.pathname);
    void cloud.joinCrew(code);
  }, [usingCloud, cloud]);

  // Deleting a party or trimming history can strand image blobs in IndexedDB.
  // One sweep per load keeps them from accumulating forever.
  useEffect(() => {
    if (!loaded) return;
    void sweepOrphans(referencedPhotoIds(store));
    // deliberately once per load, not on every store change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

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

  // Someone holding an edit link: push just their party, through the token.
  useEffect(() => {
    if (shareMode?.role !== 'edit') return;
    const base = sharedBase.current;
    if (!base) return;

    const ops = diffParty(base, party);
    if (ops.length === 0) return;

    const timer = setTimeout(() => {
      writeSharedParty(shareMode.token, ops)
        .then(() => {
          sharedBase.current = party;
        })
        .catch(() => setToast('Could not save — the link may have been revoked'));
    }, 700);

    return () => clearTimeout(timer);
  }, [party, shareMode]);
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
  const updateParty = useCallback(
    (fn: (p: Party) => Party) => {
      if (readOnly) return;
      setStore((prev) => updateCurrent(prev, prev.activeProfileId, fn));
    },
    [readOnly],
  );

  const addPeople = (names: string[]) =>
    updateParty((p) => ({
      ...p,
      people: [...p.people, ...names.map((name) => ({ id: uid(), name }))],
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

  /* ── photos ──────────────────────────────────────────────────── */
  const addPhotos = async (files: File[]) => {
    setPhotoBusy((n) => n + files.length);
    for (const file of files) {
      const id = uid();
      try {
        const saved = await savePhoto(file, id);

        if (usingCloud) {
          const blob = await getPhotoBlob(id, 'full');
          if (blob) await uploadPhoto(receiptPath(party.id, id), blob);
        }

        updateParty((p) =>
          addPhotoMeta(p, {
            id: saved.id,
            expenseId: null,
            w: saved.w,
            h: saved.h,
            bytes: saved.bytes,
            addedAt: saved.addedAt,
          }),
        );
      } catch {
        setToast('That image could not be saved — storage may be full');
      } finally {
        setPhotoBusy((n) => Math.max(0, n - 1));
      }
    }
  };

  const removePhoto = async (photoId: string) => {
    const remaining = (party.photos ?? []).filter((p) => p.id !== photoId);
    setPhotoIndex(remaining.length === 0 ? null : (i) => (i === null ? null : Math.min(i, remaining.length - 1)));
    updateParty((p) => removePhotoMeta(p, photoId));
    await deletePhoto(photoId).catch(() => undefined);
    if (usingCloud) await removePhoto_cloud(receiptPath(party.id, photoId)).catch(() => undefined);
  };

  const linkPhoto = (photoId: string, expenseId: string | null) =>
    updateParty((p) => linkPhotoToExpense(p, photoId, expenseId));

  /* ── payment details ─────────────────────────────────────────── */
  const payeeForPerson = useCallback(
    (personId: string): Payee | null => {
      const person = party.people.find((p) => p.id === personId);
      if (!person) return null;
      const found = lookupPayee(store, profileId, person.name);
      return hasPaymentDetails(found) ? found : null;
    },
    [party.people, store, profileId],
  );

  const setMemberQr = async (personId: string, file: File) => {
    const person = party.people.find((p) => p.id === personId);
    if (!person) return;

    const previous = lookupPayee(store, profileId, person.name)?.qrPhotoId ?? null;
    const id = uid();

    setPhotoBusy((n) => n + 1);
    try {
      await savePhoto(file, id, QR_ENCODE);

      if (usingCloud && cloud.activeCrewId) {
        const blob = await getPhotoBlob(id, 'full');
        if (blob) await uploadPhoto(crewPath(cloud.activeCrewId, id), blob);
      }

      setStore((prev) => setPayee(prev, prev.activeProfileId, person.name, { qrPhotoId: id }));
      if (previous) await deletePhoto(previous).catch(() => undefined);
      setToast(`Saved ${person.name}'s QR`);
    } catch {
      setToast('That image could not be saved');
    } finally {
      setPhotoBusy((n) => Math.max(0, n - 1));
    }
  };

  const clearMemberQr = async (personId: string) => {
    const person = party.people.find((p) => p.id === personId);
    if (!person) return;
    const previous = lookupPayee(store, profileId, person.name)?.qrPhotoId ?? null;
    setStore((prev) => setPayee(prev, prev.activeProfileId, person.name, { qrPhotoId: null }));
    if (previous) {
      await deletePhoto(previous).catch(() => undefined);
      if (usingCloud && cloud.activeCrewId) {
        await removePhoto_cloud(crewPath(cloud.activeCrewId, previous)).catch(() => undefined);
      }
    }
  };

  const setMemberPromptPay = (personId: string, value: string) => {
    const person = party.people.find((p) => p.id === personId);
    if (!person) return;
    setStore((prev) =>
      setPayee(prev, prev.activeProfileId, person.name, { promptPayId: value || null }),
    );
  };

  const toggleSettled = (key: string) =>
    setSettled((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

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
        id: uid(),
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
    setModal(null);
    setToast(`${name} added`);
  };

  /* ── history ─────────────────────────────────────────────────── */
  const openFromHistory = (id: string) => {
    setStore(reopenFromHistory(store, profileId, id));
    setSuggestions([]);
    setModal(null);
    setView('setup');
    setToast('Back on the workbench');
  };

  const startNewParty = () => {
    const keeping = isWorthKeeping(party);
    setStore(archiveCurrent(store, profileId));
    setSuggestions([]);
    setMenuOpen(false);
    setView('setup');
    setToast(keeping ? 'Saved to history — fresh sheet ready' : 'Fresh sheet ready');
  };

  const discardParty = () => {
    if (!window.confirm('Delete this party without saving it to history?')) return;
    void deletePhotos((party.photos ?? []).map((p) => p.id));
    setStore(setCurrent(store, profileId, newParty(party.currencyCode)));
    setSuggestions([]);
    setMenuOpen(false);
    setView('setup');
  };

  /* ── presets ─────────────────────────────────────────────────── */
  const applyPresetById = (id: string) => {
    const preset = presets.find((p) => p.id === id);
    if (!preset) return;
    setStore(updateCurrent(store, profileId, (p) => applyPreset(p, preset)));
    setSuggestions(preset.itemNames);
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
    if (usingCloud) {
      void listShareLinks(party.id)
        .then(setCloudLinks)
        .catch(() => setCloudLinks([]));
    }
  };

  const addShareLink = async (role: 'view' | 'edit') => {
    if (!usingCloud || !cloud.user) return;
    try {
      const link = await createShareLink(party.id, role, cloud.user.id);
      setCloudLinks((prev) => [...prev, link]);
      await write(`${window.location.origin}/?s=${link.token}`, 'Link created and copied');
    } catch {
      setToast('Could not create that link');
    }
  };

  const dropShareLink = async (token: string) => {
    setCloudLinks((prev) => prev.filter((l) => l.token !== token));
    await revokeShareLink(token).catch(() => setToast('Could not revoke that link'));
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
    setView('setup');
    setToast('Shared party opened');
  };

  const saveSharedOnly = () => {
    if (!incoming) return;
    setStore(saveToHistory(store, profileId, incoming.party));
    setIncoming(null);
    setToast('Saved to history');
  };

  /* ── render ──────────────────────────────────────────────────── */

  // Before there is anywhere to put the data, the app is one screen: sign in,
  // then pick a crew. Choosing to stay local skips all of it for good.
  /** The way back out of local-only. The device's data stays put and is offered up after. */
  const leaveLocalMode = () => {
    localStorage.removeItem(MODE_KEY);
    setLocalOnly(false);
    setModal(null);
    void cloud.signIn();
  };

  const chooseLocal = () => {
    localStorage.setItem(MODE_KEY, 'local');
    setLocalOnly(true);
    const { store: saved } = loadStore();
    const { store: next } = startSession(saved, saved.activeProfileId);
    setStore(next);
  };

  if (shareLoading) return <CloudLoading label="Opening the shared party…" />;

  if (usingCloud && cloud.status !== 'ready') {
    if (cloud.status === 'loading') {
      return <CloudLoading label={cloud.user ? 'Loading your parties…' : 'Just a moment…'} />;
    }
    return (
      <CloudGate
        status={cloud.status}
        error={cloud.error}
        onSignIn={() => void cloud.signIn()}
        onStartCrew={(name) => void cloud.startCrew(name)}
        onJoinCrew={(code) => void cloud.joinCrew(code)}
        onStayLocal={chooseLocal}
        onSignOut={() => void cloud.signOut()}
      />
    );
  }

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
            hidden={!!shareMode}
            onClick={() => setModal('history')}
            aria-label={`History — ${historyList.length} saved`}
          >
            <Clock />
            {historyList.length > 0 && <span className="dot-badge" />}
          </button>

          <button
            type="button"
            className="profile-btn"
            hidden={!!shareMode}
            onClick={() => setModal('profiles')}
            aria-label={`Signed in as ${profile?.name ?? 'user'} — switch user`}
          >
            <Avatar name={profile?.name ?? '?'} hue={hueForIndex(profileIndex)} size="xs" />
            <span className="profile-name">{profile?.name}</span>
            {usingCloud && cloud.syncing && <span className="sync-dot" aria-label="saving" />}
            <Chevron size={14} />
          </button>

          <span className="menu-wrap">
            <button
              type="button"
              className="icon-btn"
              hidden={!!shareMode}
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
                  <button type="button" className="danger" onClick={discardParty}>
                    <Trash /> Delete this party
                  </button>
                </span>
              </>
            )}
          </span>
        </div>
      </header>

      {shareMode && (
        <div className="share-bar">
          <span>
            {readOnly
              ? 'Someone shared this with you to look at.'
              : 'You can add what you bought — everything saves back to them.'}
          </span>
          <span className={readOnly ? 'pill' : 'pill accent'}>{readOnly ? 'View only' : 'Can edit'}</span>
        </div>
      )}

      <PartyHeader
        title={party.title}
        date={party.date}
        onTitle={(v) => updateParty((p) => ({ ...p, title: v }))}
        onDate={(v) => updateParty((p) => ({ ...p, date: v }))}
        readOnly={!!shareMode}
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
            onOpenMember={setMemberId}
            hasPayment={(id) => !!payeeForPerson(id)}
            readOnly={readOnly}
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
            photoCountFor={(id) => photosForExpense(party, id).length}
            readOnly={readOnly}
          />
          {!readOnly && (
          <PhotoShelf
            photos={party.photos ?? []}
            items={party.items}
            busy={photoBusy}
            onAdd={(files) => void addPhotos(files)}
            onOpen={(id) => setPhotoIndex((party.photos ?? []).findIndex((p) => p.id === id))}
          />
          )}
        </div>

        <div className="col-results">
          <Results
            result={result}
            people={party.people}
            currencyCode={party.currencyCode}
            hueOf={hueOf}
            onCopy={copySummary}
            settled={settled}
            onToggleSettled={toggleSettled}
            payeeFor={payeeForPerson}
            onOpenPay={setPayFor}
          />
          <Proof
            result={result}
            people={party.people}
            currencyCode={party.currencyCode}
            hueOf={hueOf}
          />
        </div>
      </main>

      <div className="dock" hidden={readOnly}>
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

      {modal === 'profiles' && usingCloud && (
        <CrewSheet
          crews={cloud.crews}
          activeId={cloud.activeCrewId}
          userName={
            (cloud.user?.user_metadata?.full_name as string | undefined) ??
            cloud.user?.email ??
            'you'
          }
          onSwitch={(id) => {
            cloud.switchCrew(id);
            setModal(null);
          }}
          onRename={(id, name) => void cloud.rename(id, name)}
          onCreate={(name) => {
            void cloud.startCrew(name);
            setModal(null);
          }}
          onJoin={(code) => {
            void cloud.joinCrew(code);
            setModal(null);
          }}
          onSignOut={() => void cloud.signOut()}
          onCopy={(text, message) => void write(text, message)}
          onClose={() => setModal(null)}
        />
      )}

      {modal === 'profiles' && !usingCloud && (
        <ProfileSheet
          profiles={store.profiles}
          activeId={profileId}
          history={store.history}
          current={store.current}
          onSwitch={doSwitchProfile}
          onAdd={doAddProfile}
          onRename={(id, name) => setStore((prev) => renameProfile(prev, id, name))}
          onDelete={(id) => setStore((prev) => deleteProfile(prev, id))}
          onSignIn={cloud.configured ? leaveLocalMode : undefined}
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
          cloudLinks={usingCloud ? cloudLinks : null}
          onCreateLink={(role) => void addShareLink(role)}
          onRevokeLink={(token) => void dropShareLink(token)}
          onCopyLink={() => write(shareUrl, 'Link copied')}
          onCopySummary={copySummary}
          onCopyText={(text, message) => void write(text, message)}
          onClose={() => setModal(null)}
        />
      )}

      {memberId &&
        (() => {
          const person = party.people.find((p) => p.id === memberId);
          if (!person) return null;
          return (
            <MemberSheet
              person={person}
              hue={hueOf(person.id)}
              payee={lookupPayee(store, profileId, person.name)}
              uses={usageOf(person.id)}
              busy={photoBusy > 0}
              onRename={(name) => renamePerson(person.id, name)}
              onSetQrImage={(file) => void setMemberQr(person.id, file)}
              onClearQrImage={() => void clearMemberQr(person.id)}
              onSetPromptPay={(value) => setMemberPromptPay(person.id, value)}
              onRemove={() => {
                removePerson(person.id);
                setMemberId(null);
              }}
              onClose={() => setMemberId(null)}
            />
          );
        })()}

      {payFor &&
        (() => {
          const from = party.people.find((p) => p.id === payFor.fromId);
          const to = party.people.find((p) => p.id === payFor.toId);
          if (!from || !to) return null;
          const key = transferKey(payFor);
          return (
            <PayQrSheet
              from={from}
              to={to}
              amount={payFor.amount}
              currencyCode={party.currencyCode}
              payee={payeeForPerson(to.id)}
              hueFrom={hueOf(from.id)}
              hueTo={hueOf(to.id)}
              settled={settled.includes(key)}
              onToggleSettled={() => toggleSettled(key)}
              onClose={() => setPayFor(null)}
            />
          );
        })()}

      {photoIndex !== null && (party.photos ?? []).length > 0 && (
        <PhotoViewer
          photos={party.photos ?? []}
          index={Math.min(photoIndex, (party.photos ?? []).length - 1)}
          items={party.items}
          currencyCode={party.currencyCode}
          onIndex={setPhotoIndex}
          onLink={linkPhoto}
          onDelete={(id) => void removePhoto(id)}
          onClose={() => setPhotoIndex(null)}
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

      {usingCloud && cloud.error && (
        <button type="button" className="toast toast-error" onClick={cloud.dismissError}>
          {cloud.error} — tap to dismiss
        </button>
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      <p className="hint" style={{ textAlign: 'center', marginTop: 22, paddingBottom: 6 }}>
        {shareMode
          ? `Shared party · ${readOnly ? 'view only' : 'you can add expenses'}`
          : usingCloud
            ? `Synced to ${cloud.activeCrew?.name ?? 'your crew'} · ${historyList.length} in history`
            : `Saved on this device only · ${historyList.length} in history`}{' '}
        · amounts in {cur.code}
      </p>
    </div>
  );
}
