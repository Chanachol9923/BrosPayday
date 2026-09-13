'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import type { Party, Store } from '../types';
import { cloudConfigured, supabase } from '../supabase/client';
import { diffGroup, type GroupSlice } from './diff';
import {
  applyOps,
  createGroup,
  joinGroupByCode,
  listGroups,
  loadGroup,
  renameGroup,
  subscribeToGroup,
  type CloudGroup,
} from './api';
import { newParty } from '../store';

export type CloudStatus =
  | 'off' // no keys configured — the app is local-only, exactly as before
  | 'loading'
  | 'signed-out'
  | 'no-crew'
  | 'ready';

const LAST_CREW_KEY = 'brospayday.crew';

/** Writes are batched behind this much quiet, so typing a title is one round trip. */
const PUSH_DEBOUNCE_MS = 700;

function sliceOf(store: Store, groupId: string): GroupSlice {
  return {
    current: store.current[groupId] ?? null,
    history: store.history[groupId] ?? [],
    presets: store.presets[groupId] ?? [],
    payees: store.payees[groupId] ?? {},
  };
}

export function useCloud(store: Store, setStore: (next: Store | ((prev: Store) => Store)) => void) {
  const [status, setStatus] = useState<CloudStatus>(cloudConfigured ? 'loading' : 'off');
  const [user, setUser] = useState<User | null>(null);
  const [crews, setCrews] = useState<CloudGroup[]>([]);
  const [activeCrewId, setActiveCrewId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  // What the database is believed to hold. Diffs are taken against this, not
  // against the previous render, so a failed push is retried rather than lost.
  const confirmed = useRef<GroupSlice | null>(null);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applying = useRef(false);

  /* ── session ───────────────────────────────────────────────────── */
  useEffect(() => {
    if (!cloudConfigured) return;
    const db = supabase();
    if (!db) return;

    let alive = true;

    db.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setUser(data.session?.user ?? null);
      setStatus(data.session ? 'loading' : 'signed-out');
    });

    const { data: sub } = db.auth.onAuthStateChange((_event: string, session: Session | null) => {
      if (!alive) return;
      setUser(session?.user ?? null);
      if (!session) {
        setStatus('signed-out');
        setActiveCrewId(null);
        confirmed.current = null;
      }
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  /* ── which crews am I in ───────────────────────────────────────── */
  const refreshCrews = useCallback(async () => {
    if (!user) return;
    try {
      const found = await listGroups();
      setCrews(found);

      if (found.length === 0) {
        setActiveCrewId(null);
        setStatus('no-crew');
        return;
      }

      const remembered = localStorage.getItem(LAST_CREW_KEY);
      const pick = found.find((c) => c.id === remembered)?.id ?? found[0].id;
      setActiveCrewId(pick);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your crews.');
      setStatus('signed-out');
    }
  }, [user]);

  useEffect(() => {
    if (user) void refreshCrews();
  }, [user, refreshCrews]);

  /* ── pull a crew's data into the store ─────────────────────────── */
  const pull = useCallback(
    async (groupId: string) => {
      try {
        const data = await loadGroup(groupId);
        const current: Party = data.current ?? newParty();

        applying.current = true;
        setStore((prev) => ({
          ...prev,
          profiles: crews.map((c) => ({ id: c.id, name: c.name, createdAt: 0 })),
          activeProfileId: groupId,
          current: { ...prev.current, [groupId]: current },
          history: { ...prev.history, [groupId]: data.history },
          presets: { ...prev.presets, [groupId]: data.presets },
          payees: { ...prev.payees, [groupId]: data.payees },
        }));

        confirmed.current = {
          current: data.current,
          history: data.history,
          presets: data.presets,
          payees: data.payees,
        };
        setStatus('ready');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load this crew.');
      } finally {
        applying.current = false;
      }
    },
    [crews, setStore],
  );

  useEffect(() => {
    if (!activeCrewId || !user) return;
    localStorage.setItem(LAST_CREW_KEY, activeCrewId);
    void pull(activeCrewId);
    // crews is intentionally out of the deps: renaming one should not refetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCrewId, user]);

  /* ── push local changes up ─────────────────────────────────────── */
  useEffect(() => {
    if (status !== 'ready' || !activeCrewId || !user) return;
    if (applying.current) return;

    const base = confirmed.current;
    if (!base) return;

    const next = sliceOf(store, activeCrewId);
    const ops = diffGroup(base, next);
    if (ops.length === 0) return;

    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      const archivedIds = new Set(next.history.map((p) => p.id));
      setSyncing(true);
      applyOps(ops, { groupId: activeCrewId, userId: user.id, archivedIds })
        .then(() => {
          confirmed.current = next;
          setError(null);
        })
        .catch((e) => {
          // confirmed is left alone, so the same change is retried on the next edit
          setError(e instanceof Error ? e.message : 'Could not save to the cloud.');
        })
        .finally(() => setSyncing(false));
    }, PUSH_DEBOUNCE_MS);

    return () => {
      if (pushTimer.current) clearTimeout(pushTimer.current);
    };
  }, [store, status, activeCrewId, user]);

  /* ── somebody else changed something ───────────────────────────── */
  useEffect(() => {
    if (status !== 'ready' || !activeCrewId) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeToGroup(activeCrewId, () => {
      // A push of our own comes back as a change too; wait for quiet, then re-read.
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!pushTimer.current && !applying.current) void pull(activeCrewId);
      }, 900);
    });

    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [status, activeCrewId, pull]);

  /* ── actions ───────────────────────────────────────────────────── */
  const signIn = useCallback(async () => {
    const db = supabase();
    if (!db) return;
    const { error: signInError } = await db.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (signInError) setError(signInError.message);
  }, []);

  const signOut = useCallback(async () => {
    const db = supabase();
    if (!db) return;
    localStorage.removeItem(LAST_CREW_KEY);
    await db.auth.signOut();
  }, []);

  const startCrew = useCallback(
    async (name: string) => {
      if (!user) return;
      try {
        const crew = await createGroup(name, user.id);
        setCrews((prev) => [...prev, crew]);
        setActiveCrewId(crew.id);
        setStatus('loading');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not start that crew.');
      }
    },
    [user],
  );

  const joinCrew = useCallback(async (code: string) => {
    try {
      const groupId = await joinGroupByCode(code.trim().toUpperCase());
      const found = await listGroups();
      setCrews(found);
      setActiveCrewId(groupId);
      setStatus('loading');
    } catch {
      setError('No crew has that code.');
    }
  }, []);

  const switchCrew = useCallback((id: string) => {
    setStatus('loading');
    setActiveCrewId(id);
  }, []);

  const rename = useCallback(async (id: string, name: string) => {
    setCrews((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
    try {
      await renameGroup(id, name);
    } catch {
      /* the name is cosmetic; a failure here is not worth interrupting anyone */
    }
  }, []);

  const activeCrew = useMemo(() => crews.find((c) => c.id === activeCrewId) ?? null, [crews, activeCrewId]);

  return {
    configured: cloudConfigured,
    status,
    user,
    crews,
    activeCrew,
    activeCrewId,
    error,
    syncing,
    signIn,
    signOut,
    startCrew,
    joinCrew,
    switchCrew,
    rename,
    dismissError: () => setError(null),
  };
}
