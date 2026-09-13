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
  | 'ready';

const LAST_GROUP_KEY = 'brospayday.group';

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
  const [groups, setGroups] = useState<CloudGroup[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
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
        setActiveGroupId(null);
        confirmed.current = null;
      }
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  /* ── where your events live ─────────────────────────────────────── */
  const refreshGroups = useCallback(async () => {
    if (!user) return;
    try {
      let found = await listGroups();

      // Nobody should have to answer "which workspace?" before they can add an
      // expense. The first sign-in quietly gets one; sharing it with other people
      // is a thing you go looking for, not a gate you walk through.
      if (found.length === 0) {
        const name =
          (user.user_metadata?.full_name as string | undefined)?.split(' ')[0] ??
          user.email?.split('@')[0] ??
          'My';
        await createGroup(`${name}'s events`);
        found = await listGroups();
      }

      setGroups(found);
      if (found.length === 0) {
        setError('Could not set up your events.');
        setStatus('signed-out');
        return;
      }

      const remembered = localStorage.getItem(LAST_GROUP_KEY);
      const pick = found.find((c) => c.id === remembered)?.id ?? found[0].id;
      setActiveGroupId(pick);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your events.');
      setStatus('signed-out');
    }
  }, [user]);

  useEffect(() => {
    if (user) void refreshGroups();
  }, [user, refreshGroups]);

  /* ── pull a Group's data into the store ─────────────────────────── */
  const pull = useCallback(
    async (groupId: string) => {
      try {
        const data = await loadGroup(groupId);
        const current: Party = data.current ?? newParty();

        applying.current = true;
        setStore((prev) => ({
          ...prev,
          profiles: groups.map((c) => ({ id: c.id, name: c.name, createdAt: 0 })),
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
        setError(e instanceof Error ? e.message : 'Could not load this Group.');
      } finally {
        applying.current = false;
      }
    },
    [groups, setStore],
  );

  useEffect(() => {
    if (!activeGroupId || !user) return;
    localStorage.setItem(LAST_GROUP_KEY, activeGroupId);
    void pull(activeGroupId);
    // groups is intentionally out of the deps: renaming one should not refetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroupId, user]);

  /* ── push local changes up ─────────────────────────────────────── */
  useEffect(() => {
    if (status !== 'ready' || !activeGroupId || !user) return;
    if (applying.current) return;

    const base = confirmed.current;
    if (!base) return;

    const next = sliceOf(store, activeGroupId);
    const ops = diffGroup(base, next);
    if (ops.length === 0) return;

    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      const archivedIds = new Set(next.history.map((p) => p.id));
      setSyncing(true);
      applyOps(ops, { groupId: activeGroupId, userId: user.id, archivedIds })
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
  }, [store, status, activeGroupId, user]);

  /* ── somebody else changed something ───────────────────────────── */
  useEffect(() => {
    if (status !== 'ready' || !activeGroupId) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeToGroup(activeGroupId, () => {
      // A push of our own comes back as a change too; wait for quiet, then re-read.
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!pushTimer.current && !applying.current) void pull(activeGroupId);
      }, 900);
    });

    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [status, activeGroupId, pull]);

  /* ── actions ───────────────────────────────────────────────────── */
  /**
   * `next` is where to land afterwards — someone who followed an invite link has
   * to come back to that event, not to a blank sheet. Only a path on this site is
   * accepted; anything else is dropped rather than trusted, and the callback
   * checks it again on the way back.
   */
  const signIn = useCallback(async (next?: string) => {
    const db = supabase();
    if (!db) return;

    const safe =
      typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : null;
    const callback = `${window.location.origin}/auth/callback${
      safe ? `?next=${encodeURIComponent(safe)}` : ''
    }`;

    const { error: signInError } = await db.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callback },
    });
    if (signInError) setError(signInError.message);
  }, []);

  const signOut = useCallback(async () => {
    const db = supabase();
    if (!db) return;
    localStorage.removeItem(LAST_GROUP_KEY);
    await db.auth.signOut();
  }, []);

  const startGroup = useCallback(
    async (name: string) => {
      if (!user) return;
      try {
        const group = await createGroup(name);
        setGroups((prev) => [...prev, group]);
        setActiveGroupId(group.id);
        setStatus('loading');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not create that workspace.');
      }
    },
    [user],
  );

  const joinGroup = useCallback(async (code: string) => {
    try {
      const groupId = await joinGroupByCode(code.trim().toUpperCase());
      const found = await listGroups();
      setGroups(found);
      setActiveGroupId(groupId);
      setStatus('loading');
    } catch {
      setError('Nothing found for that code.');
    }
  }, []);

  const switchGroup = useCallback((id: string) => {
    setStatus('loading');
    setActiveGroupId(id);
  }, []);

  const rename = useCallback(async (id: string, name: string) => {
    setGroups((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
    try {
      await renameGroup(id, name);
    } catch {
      /* the name is cosmetic; a failure here is not worth interrupting anyone */
    }
  }, []);

  const activeGroup = useMemo(() => groups.find((c) => c.id === activeGroupId) ?? null, [groups, activeGroupId]);

  return {
    configured: cloudConfigured,
    status,
    user,
    groups,
    activeGroup,
    activeGroupId,
    error,
    syncing,
    signIn,
    signOut,
    startGroup,
    joinGroup,
    switchGroup,
    rename,
    dismissError: () => setError(null),
  };
}
