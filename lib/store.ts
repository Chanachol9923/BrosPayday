import type { Party, Person, Preset, Profile, Store } from './types';
import { uid } from './format';
import { exampleState } from './example';

const KEY = 'brospayday.store.v2';
const LEGACY_KEY = 'brospayday.state.v1';
/** Per-profile marker. sessionStorage survives a reload but dies with the tab. */
const sessionKey = (profileId: string) => `brospayday.session.${profileId}`;

const HISTORY_LIMIT = 200;

/* ── dates ───────────────────────────────────────────────────────── */

export function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parsed as local time on purpose — `new Date('2026-09-13')` is UTC and can slip a day. */
export function formatDate(iso: string): string {
  const [y, m, d] = (iso ?? '').split('-').map(Number);
  if (!y || !m || !d) return iso ?? '';
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function relativeDate(iso: string): string {
  const today = todayISO();
  if (iso === today) return 'Today';

  const [y, m, d] = (iso ?? '').split('-').map(Number);
  if (!y || !m || !d) return formatDate(iso);

  const then = new Date(y, m - 1, d);
  const now = new Date();
  const days = Math.round((now.setHours(0, 0, 0, 0) - then.getTime()) / 86400000);

  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return `${days} days ago`;
  return formatDate(iso);
}

/* ── parties ─────────────────────────────────────────────────────── */

export function newParty(currencyCode = 'THB'): Party {
  const now = Date.now();
  return {
    id: uid('party'),
    title: '',
    date: todayISO(),
    currencyCode,
    people: [],
    items: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function sampleParty(): Party {
  const base = exampleState();
  const now = Date.now();
  return { ...base, id: uid('party'), date: todayISO(), createdAt: now, updatedAt: now };
}

/** A party is worth archiving once money has been entered. */
export function isWorthKeeping(p: Party | null | undefined): boolean {
  return !!p && p.items.length > 0;
}

export function partyLabel(p: Party): string {
  return p.title.trim() || 'Untitled party';
}

/* ── store ───────────────────────────────────────────────────────── */

export function emptyStore(): Store {
  const profile: Profile = { id: uid('u'), name: 'Me', createdAt: Date.now() };
  return {
    version: 2,
    profiles: [profile],
    activeProfileId: profile.id,
    current: { [profile.id]: newParty() },
    history: { [profile.id]: [] },
    presets: { [profile.id]: [] },
  };
}

function coerce(raw: unknown): Store | null {
  const s = raw as Store;
  if (!s || s.version !== 2 || !Array.isArray(s.profiles) || s.profiles.length === 0) return null;
  if (!s.profiles.some((p) => p.id === s.activeProfileId)) s.activeProfileId = s.profiles[0].id;

  s.current = s.current ?? {};
  s.history = s.history ?? {};
  s.presets = s.presets ?? {};
  for (const p of s.profiles) {
    if (!s.current[p.id]) s.current[p.id] = newParty();
    if (!Array.isArray(s.history[p.id])) s.history[p.id] = [];
    if (!Array.isArray(s.presets[p.id])) s.presets[p.id] = [];
  }
  return s;
}

/** The pre-profiles format kept a single bare party under its own key. */
function migrateLegacy(): Store | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;

    const old = JSON.parse(raw) as Partial<Party>;
    if (!old || !Array.isArray(old.people) || !Array.isArray(old.items)) return null;

    const store = emptyStore();
    const pid = store.activeProfileId;
    const now = Date.now();

    store.history[pid] = [
      {
        id: uid('party'),
        title: old.title || 'Imported party',
        date: todayISO(),
        currencyCode: old.currencyCode || 'THB',
        people: old.people,
        items: old.items,
        createdAt: now,
        updatedAt: now,
      },
    ];
    localStorage.removeItem(LEGACY_KEY);
    return store;
  } catch {
    return null;
  }
}

export function loadStore(): { store: Store; firstRun: boolean } {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = coerce(JSON.parse(raw));
      if (parsed) return { store: parsed, firstRun: false };
    }
    const migrated = migrateLegacy();
    if (migrated) return { store: migrated, firstRun: false };
  } catch {
    /* unreadable storage — fall through to a clean start */
  }
  return { store: emptyStore(), firstRun: true };
}

export function saveStore(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* private mode / quota — the app still works, it just won't persist */
  }
}

/* ── session: fresh sheet on every visit, reload-safe ─────────────── */

/**
 * Opening the site should hand you a clean party, not the one you finished last
 * night — but pressing refresh mid-party must not wipe your work. The marker in
 * sessionStorage tells the two apart: it survives a reload, dies with the tab.
 */
export function startSession(store: Store, profileId: string): { store: Store; archived: Party | null } {
  const current = store.current[profileId];

  let marker: string | null = null;
  try {
    marker = sessionStorage.getItem(sessionKey(profileId));
  } catch {
    /* no sessionStorage — treat every load as a fresh visit */
  }

  if (marker && current && marker === current.id) return { store, archived: null };

  let next = store;
  let archived: Party | null = null;

  if (isWorthKeeping(current)) {
    archived = { ...current, updatedAt: Date.now() };
    next = pushHistory(next, profileId, archived);
  }

  const fresh = newParty(current?.currencyCode ?? 'THB');
  next = { ...next, current: { ...next.current, [profileId]: fresh } };

  try {
    sessionStorage.setItem(sessionKey(profileId), fresh.id);
  } catch {
    /* ignore */
  }

  return { store: next, archived };
}

function markSession(partyId: string, profileId: string): void {
  try {
    sessionStorage.setItem(sessionKey(profileId), partyId);
  } catch {
    /* ignore */
  }
}

/* ── history ─────────────────────────────────────────────────────── */

function pushHistory(store: Store, profileId: string, party: Party): Store {
  const existing = store.history[profileId] ?? [];
  const without = existing.filter((p) => p.id !== party.id);
  return {
    ...store,
    history: { ...store.history, [profileId]: [party, ...without].slice(0, HISTORY_LIMIT) },
  };
}

/** Explicit "save and start a new one". */
export function archiveCurrent(store: Store, profileId: string): Store {
  const current = store.current[profileId];
  let next = store;
  if (isWorthKeeping(current)) next = pushHistory(next, profileId, { ...current, updatedAt: Date.now() });

  const fresh = newParty(current?.currencyCode ?? 'THB');
  markSession(fresh.id, profileId);
  return { ...next, current: { ...next.current, [profileId]: fresh } };
}

/** Reopening pulls the party back out of history rather than cloning it. */
export function reopenFromHistory(store: Store, profileId: string, partyId: string): Store {
  const list = store.history[profileId] ?? [];
  const target = list.find((p) => p.id === partyId);
  if (!target) return store;

  let next = store;
  const current = store.current[profileId];
  if (isWorthKeeping(current) && current.id !== partyId) {
    next = pushHistory(next, profileId, { ...current, updatedAt: Date.now() });
  }

  next = {
    ...next,
    history: { ...next.history, [profileId]: (next.history[profileId] ?? []).filter((p) => p.id !== partyId) },
    current: { ...next.current, [profileId]: target },
  };
  markSession(target.id, profileId);
  return next;
}

export function deleteFromHistory(store: Store, profileId: string, partyId: string): Store {
  return {
    ...store,
    history: {
      ...store.history,
      [profileId]: (store.history[profileId] ?? []).filter((p) => p.id !== partyId),
    },
  };
}

export function saveToHistory(store: Store, profileId: string, party: Party): Store {
  return pushHistory(store, profileId, party);
}

/* ── profiles ────────────────────────────────────────────────────── */

export function addProfile(store: Store, name: string): Store {
  const profile: Profile = { id: uid('u'), name: name.trim() || 'New user', createdAt: Date.now() };
  const fresh = newParty(store.current[store.activeProfileId]?.currencyCode ?? 'THB');
  markSession(fresh.id, profile.id);

  return {
    ...store,
    profiles: [...store.profiles, profile],
    activeProfileId: profile.id,
    current: { ...store.current, [profile.id]: fresh },
    history: { ...store.history, [profile.id]: [] },
    presets: { ...store.presets, [profile.id]: [] },
  };
}

export function renameProfile(store: Store, profileId: string, name: string): Store {
  return {
    ...store,
    profiles: store.profiles.map((p) => (p.id === profileId ? { ...p, name } : p)),
  };
}

export function deleteProfile(store: Store, profileId: string): Store {
  if (store.profiles.length <= 1) return store;

  const profiles = store.profiles.filter((p) => p.id !== profileId);
  const { [profileId]: _c, ...current } = store.current;
  const { [profileId]: _h, ...history } = store.history;
  const { [profileId]: _p, ...presets } = store.presets;

  return {
    ...store,
    profiles,
    activeProfileId: store.activeProfileId === profileId ? profiles[0].id : store.activeProfileId,
    current,
    history,
    presets,
  };
}

export function switchProfile(store: Store, profileId: string): Store {
  if (!store.profiles.some((p) => p.id === profileId)) return store;
  return { ...store, activeProfileId: profileId };
}

export function updateCurrent(store: Store, profileId: string, fn: (p: Party) => Party): Store {
  const current = store.current[profileId];
  if (!current) return store;
  return {
    ...store,
    current: { ...store.current, [profileId]: { ...fn(current), updatedAt: Date.now() } },
  };
}

export function setCurrent(store: Store, profileId: string, party: Party): Store {
  markSession(party.id, profileId);
  return { ...store, current: { ...store.current, [profileId]: party } };
}

/* ── presets ─────────────────────────────────────────────────────── */

/** Capture the crew and the usual expense names from a party, amounts dropped. */
export function presetFromParty(party: Party, name: string): Preset {
  const seen = new Set<string>();
  const itemNames: string[] = [];
  for (const item of party.items) {
    const label = item.name.trim();
    const key = label.toLowerCase();
    if (label && !seen.has(key)) {
      seen.add(key);
      itemNames.push(label);
    }
  }

  return {
    id: uid('preset'),
    name: name.trim() || 'Untitled preset',
    title: party.title.trim(),
    currencyCode: party.currencyCode,
    people: party.people.map((p) => p.name.trim()).filter(Boolean),
    itemNames,
    createdAt: Date.now(),
  };
}

export function addPreset(store: Store, profileId: string, preset: Preset): Store {
  const existing = store.presets[profileId] ?? [];
  return {
    ...store,
    presets: { ...store.presets, [profileId]: [preset, ...existing] },
  };
}

export function deletePreset(store: Store, profileId: string, presetId: string): Store {
  return {
    ...store,
    presets: {
      ...store.presets,
      [profileId]: (store.presets[profileId] ?? []).filter((p) => p.id !== presetId),
    },
  };
}

export function renamePreset(store: Store, profileId: string, presetId: string, name: string): Store {
  return {
    ...store,
    presets: {
      ...store.presets,
      [profileId]: (store.presets[profileId] ?? []).map((p) => (p.id === presetId ? { ...p, name } : p)),
    },
  };
}

/**
 * Drop a preset onto the current party. Names already present are left alone, so
 * applying twice — or applying two overlapping presets — never doubles anyone up.
 */
export function applyPreset(party: Party, preset: Preset): Party {
  const taken = new Set(party.people.map((p) => p.name.trim().toLowerCase()));
  const added: Person[] = [];

  for (const name of preset.people) {
    const key = name.trim().toLowerCase();
    if (key && !taken.has(key)) {
      taken.add(key);
      added.push({ id: uid('p'), name: name.trim() });
    }
  }

  return {
    ...party,
    title: party.title.trim() || preset.title,
    currencyCode: party.items.length === 0 ? preset.currencyCode : party.currencyCode,
    people: [...party.people, ...added],
    updatedAt: Date.now(),
  };
}

/**
 * A fixed, id-stable store for the first server render. Real data is loaded in an
 * effect; using random ids here would make the server and client markup disagree.
 */
export function placeholderStore(): Store {
  const pid = 'u_placeholder';
  const party: Party = {
    id: 'party_placeholder',
    title: '',
    date: '',
    currencyCode: 'THB',
    people: [],
    items: [],
    createdAt: 0,
    updatedAt: 0,
  };
  return {
    version: 2,
    profiles: [{ id: pid, name: 'Me', createdAt: 0 }],
    activeProfileId: pid,
    current: { [pid]: party },
    history: { [pid]: [] },
    presets: { [pid]: [] },
  };
}
