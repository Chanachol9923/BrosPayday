'use client';

import type { Party, Payee, Preset } from '../types';
import type { RowOp } from './diff';
import { supabase } from '../supabase/client';

/**
 * Everything the app says to the database.
 *
 * Rows come back shaped the way the rest of the app already thinks — a Party with
 * people and items — so the UI never learns that a database exists. Writes go the
 * other way as the row operations produced by `diff.ts`, which is what keeps two
 * people editing the same night from overwriting each other.
 */

export type CloudGroup = { id: string; name: string; joinCode: string };

export type GroupData = {
  /** The party nobody has archived yet, if there is one. */
  current: Party | null;
  history: Party[];
  presets: Preset[];
  payees: Record<string, Payee>;
};

function client() {
  const db = supabase();
  if (!db) throw new Error('Cloud sync is not configured.');
  return db;
}

/* ── groups ──────────────────────────────────────────────────────── */

export async function listGroups(): Promise<CloudGroup[]> {
  const { data, error } = await client()
    .from('groups')
    .select('id, name, join_code')
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data ?? []).map((g) => ({ id: g.id, name: g.name, joinCode: g.join_code }));
}

export async function createGroup(name: string): Promise<CloudGroup> {
  // One call, server side: the group and the creator's membership are created
  // together. Doing it as two client statements meant the insert's RETURNING had
  // to pass a select policy that asks whether you are a member — which you were
  // not yet — so the row came back empty and the group was stranded.
  const { data, error } = await client().rpc('create_group', { name });
  if (error) throw error;

  const row = data as { id: string; name: string; join_code: string } | null;
  if (!row) throw new Error('The group was not created.');

  return { id: row.id, name: row.name, joinCode: row.join_code };
}

export async function joinGroupByCode(code: string): Promise<string> {
  const { data, error } = await client().rpc('join_group_by_code', { code });
  if (error) throw error;
  return data as string;
}

export async function renameGroup(groupId: string, name: string): Promise<void> {
  const { error } = await client().from('groups').update({ name }).eq('id', groupId);
  if (error) throw error;
}

export async function leaveGroup(groupId: string, userId: string): Promise<void> {
  const { error } = await client()
    .from('group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function listMembers(groupId: string): Promise<{ id: string; name: string; avatar: string | null }[]> {
  const db = client();
  const { data: rows, error } = await db.from('group_members').select('user_id').eq('group_id', groupId);
  if (error) throw error;

  const ids = (rows ?? []).map((r) => r.user_id);
  if (ids.length === 0) return [];

  const { data: people, error: peopleError } = await db
    .from('profiles')
    .select('id, display_name, avatar_url')
    .in('id', ids);
  if (peopleError) throw peopleError;

  return (people ?? []).map((p) => ({ id: p.id, name: p.display_name, avatar: p.avatar_url }));
}

/* ── reading a group's parties ───────────────────────────────────── */

type PartyRow = {
  id: string;
  title: string;
  party_date: string;
  currency_code: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function loadGroup(groupId: string): Promise<GroupData> {
  const db = client();

  const [partiesRes, presetsRes, payeesRes] = await Promise.all([
    db.from('parties').select('*').eq('group_id', groupId).order('updated_at', { ascending: false }),
    db.from('presets').select('*').eq('group_id', groupId).order('created_at', { ascending: false }),
    db.from('payees').select('*').eq('group_id', groupId),
  ]);

  if (partiesRes.error) throw partiesRes.error;
  if (presetsRes.error) throw presetsRes.error;
  if (payeesRes.error) throw payeesRes.error;

  const partyRows = (partiesRes.data ?? []) as PartyRow[];
  const partyIds = partyRows.map((p) => p.id);

  const [peopleRes, expenseRes, shareRes, photoRes, repayRes] =
    partyIds.length === 0
      ? [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }]
      : await Promise.all([
          db.from('party_people').select('*').in('party_id', partyIds).order('sort_order'),
          db.from('expenses').select('*').in('party_id', partyIds).order('sort_order'),
          db.from('expense_shares').select('*'),
          db.from('photos').select('*').in('party_id', partyIds),
          db.from('repayments').select('*').in('party_id', partyIds),
        ]);

  const sharesByExpense = new Map<string, { person_id: string; weight: number; extra: number }[]>();
  for (const row of (shareRes.data ?? []) as {
    expense_id: string;
    person_id: string;
    weight: number;
    extra: number;
  }[]) {
    const list = sharesByExpense.get(row.expense_id) ?? [];
    list.push(row);
    sharesByExpense.set(row.expense_id, list);
  }

  const parties: Party[] = partyRows.map((row) => {
    const people = ((peopleRes.data ?? []) as { id: string; party_id: string; name: string }[])
      .filter((p) => p.party_id === row.id)
      .map((p) => ({ id: p.id, name: p.name }));

    const items = (
      (expenseRes.data ?? []) as {
        id: string;
        party_id: string;
        name: string;
        amount: number;
        payer_id: string | null;
      }[]
    )
      .filter((e) => e.party_id === row.id)
      .map((e) => {
        const shares = sharesByExpense.get(e.id) ?? [];
        const weights: Record<string, number> = {};
        const extras: Record<string, number> = {};
        for (const s of shares) {
          if (s.weight !== 1) weights[s.person_id] = s.weight;
          if (s.extra) extras[s.person_id] = Number(s.extra);
        }

        return {
          id: e.id,
          name: e.name,
          amount: Number(e.amount),
          payerId: e.payer_id,
          bearerIds: shares.map((s) => s.person_id),
          weights,
          extras,
        };
      });

    const photos = (
      (photoRes.data ?? []) as {
        id: string;
        party_id: string;
        expense_id: string | null;
        bytes: number;
        w: number;
        h: number;
        created_at: string;
      }[]
    )
      .filter((p) => p.party_id === row.id)
      .map((p) => ({
        id: p.id,
        expenseId: p.expense_id,
        bytes: p.bytes,
        w: p.w,
        h: p.h,
        addedAt: new Date(p.created_at).getTime(),
      }));

    const repayments: Record<string, number> = {};
    for (const r of (repayRes.data ?? []) as {
      party_id: string;
      from_person: string;
      to_person: string;
      amount_paid: number;
    }[]) {
      if (r.party_id === row.id) repayments[`${r.from_person}>${r.to_person}`] = Number(r.amount_paid);
    }

    return {
      id: row.id,
      title: row.title,
      date: row.party_date,
      currencyCode: row.currency_code,
      people,
      items,
      photos,
      repayments,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
    };
  });

  const archivedIds = new Set(partyRows.filter((r) => r.archived_at).map((r) => r.id));
  const live = parties.filter((p) => !archivedIds.has(p.id));
  const history = parties.filter((p) => archivedIds.has(p.id));

  // More than one unarchived party means two devices each started one. Keep the
  // most recently touched on the workbench and file the rest, rather than losing any.
  const [current, ...strays] = live;

  const presets: Preset[] = (presetsRes.data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    title: p.title,
    currencyCode: p.currency_code,
    people: p.people ?? [],
    itemNames: p.item_names ?? [],
    createdAt: new Date(p.created_at).getTime(),
  }));

  const payees: Record<string, Payee> = {};
  for (const row of payeesRes.data ?? []) {
    payees[row.name_key] = {
      name: row.display_name,
      promptPayId: row.promptpay_id,
      qrPhotoId: row.qr_storage_path,
      updatedAt: new Date(row.updated_at).getTime(),
    };
  }

  return { current: current ?? null, history: [...strays, ...history], presets, payees };
}

/* ── writing ─────────────────────────────────────────────────────── */

/**
 * Send a batch of row operations. Order matters: people and expenses have to
 * exist before the rows that point at them, and deletes go last so a row is
 * never removed while something still references it.
 */
export async function applyOps(ops: RowOp[], ctx: { groupId: string; userId: string; archivedIds: Set<string> }): Promise<void> {
  if (ops.length === 0) return;
  const db = client();

  const upserts = ops.filter((o) => o.op !== 'delete');
  const deletes = ops.filter((o) => o.op === 'delete');

  const run = async (op: RowOp) => {
    switch (op.table) {
      case 'parties': {
        if (op.op === 'delete') {
          // Deleting takes it out of your history, not everybody's. The row only
          // leaves the database once the last person holding it lets go.
          const { error } = await db.rpc('hide_event', { p_party_id: op.id });
          if (error) throw error;
          return;
        }
        const { error } = await db.from('parties').upsert({
          id: op.party.id,
          group_id: ctx.groupId,
          title: op.party.title,
          party_date: op.party.date,
          currency_code: op.party.currencyCode,
          archived_at: ctx.archivedIds.has(op.party.id) ? new Date().toISOString() : null,
          created_by: ctx.userId,
          updated_at: new Date().toISOString(),
        });
        if (error) throw error;
        return;
      }

      case 'party_people': {
        if (op.op === 'delete') {
          const { error } = await db.from('party_people').delete().eq('id', op.id);
          if (error) throw error;
          return;
        }
        const { error } = await db
          .from('party_people')
          .upsert({ id: op.id, party_id: op.partyId, name: op.name, sort_order: op.order });
        if (error) throw error;
        return;
      }

      case 'expenses': {
        if (op.op === 'delete') {
          const { error } = await db.from('expenses').delete().eq('id', op.id);
          if (error) throw error;
          return;
        }
        const { error } = await db.from('expenses').upsert({
          id: op.item.id,
          party_id: op.partyId,
          name: op.item.name,
          amount: op.item.amount,
          payer_id: op.item.payerId,
          sort_order: op.order,
          created_by: ctx.userId,
          updated_at: new Date().toISOString(),
        });
        if (error) throw error;
        return;
      }

      case 'expense_shares': {
        const { error: clearError } = await db.from('expense_shares').delete().eq('expense_id', op.expenseId);
        if (clearError) throw clearError;
        if (op.shares.length === 0) return;

        const { error } = await db.from('expense_shares').insert(
          op.shares.map((s) => ({
            expense_id: op.expenseId,
            person_id: s.personId,
            weight: s.weight,
            extra: s.extra,
          })),
        );
        if (error) throw error;
        return;
      }

      case 'photos': {
        if (op.op === 'delete') {
          const { error } = await db.from('photos').delete().eq('id', op.id);
          if (error) throw error;
          return;
        }
        const { error } = await db.from('photos').upsert({
          id: op.photo.id,
          party_id: op.partyId,
          expense_id: op.photo.expenseId,
          storage_path: `${op.partyId}/${op.photo.id}`,
          bytes: op.photo.bytes,
          w: op.photo.w,
          h: op.photo.h,
          created_by: ctx.userId,
        });
        if (error) throw error;
        return;
      }

      case 'presets': {
        if (op.op === 'delete') {
          const { error } = await db.from('presets').delete().eq('id', op.id);
          if (error) throw error;
          return;
        }
        const { error } = await db.from('presets').upsert({
          id: op.preset.id,
          group_id: ctx.groupId,
          name: op.preset.name,
          title: op.preset.title,
          currency_code: op.preset.currencyCode,
          people: op.preset.people,
          item_names: op.preset.itemNames,
        });
        if (error) throw error;
        return;
      }

      case 'repayments': {
        if (op.op === 'delete') {
          const { error } = await db
            .from('repayments')
            .delete()
            .eq('party_id', op.partyId)
            .eq('from_person', op.fromId)
            .eq('to_person', op.toId);
          if (error) throw error;
          return;
        }
        const { error } = await db.from('repayments').upsert({
          party_id: op.partyId,
          from_person: op.fromId,
          to_person: op.toId,
          amount_paid: op.amountPaid,
          updated_at: new Date().toISOString(),
          updated_by: ctx.userId,
        });
        if (error) throw error;
        return;
      }

      case 'payees': {
        if (op.op === 'delete') {
          const { error } = await db.from('payees').delete().eq('group_id', ctx.groupId).eq('name_key', op.key);
          if (error) throw error;
          return;
        }
        const { error } = await db.from('payees').upsert({
          group_id: ctx.groupId,
          name_key: op.key,
          display_name: op.payee.name,
          promptpay_id: op.payee.promptPayId ?? null,
          qr_storage_path: op.payee.qrPhotoId ?? null,
          updated_at: new Date().toISOString(),
        });
        if (error) throw error;
        return;
      }
    }
  };

  for (const op of upserts) await run(op);
  for (const op of deletes) await run(op);
}

/* ── live updates ────────────────────────────────────────────────── */

export function subscribeToGroup(groupId: string, onChange: () => void): () => void {
  const db = supabase();
  if (!db) return () => undefined;

  const channel = db
    .channel(`group:${groupId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'parties' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'party_people' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_shares' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'photos' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'repayments' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'payees' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'presets' }, onChange)
    .subscribe();

  return () => {
    void db.removeChannel(channel);
  };
}

/* ── share links ─────────────────────────────────────────────────── */

export type ShareLink = { token: string; role: 'view' | 'edit' };

/**
 * The code for this event and this role, made the first time it is asked for.
 * One code per event per role: asking again returns the same one, so there is
 * never a trail of codes nobody remembers handing out.
 */
export async function eventShareCode(partyId: string, role: 'view' | 'edit'): Promise<string> {
  const { data, error } = await client().rpc('event_share_code', {
    p_party_id: partyId,
    p_role: role,
  });
  if (error) throw error;
  return data as string;
}

export async function revokeEventShare(partyId: string, role: 'view' | 'edit'): Promise<void> {
  const { error } = await client().rpc('revoke_event_share', {
    p_party_id: partyId,
    p_role: role,
  });
  if (error) throw error;
}

/** Which codes this event already has, without minting any. */
export async function listShareLinks(partyId: string): Promise<ShareLink[]> {
  const { data, error } = await client()
    .from('party_shares')
    .select('token, role')
    .eq('party_id', partyId)
    .is('revoked_at', null);

  if (error) throw error;
  return (data ?? []) as ShareLink[];
}

export type SharedPartyView = { role: 'view' | 'edit'; party: Party };

/** Read a party with nothing but a link. No sign-in, no Group. */
export async function readSharedParty(token: string): Promise<SharedPartyView | null> {
  const db = supabase();
  if (!db) return null;

  const { data, error } = await db.rpc('share_read', { tok: token });
  if (error || !data) return null;

  const raw = data as {
    role: 'view' | 'edit';
    party: { id: string; title: string; party_date: string; currency_code: string; created_at: string; updated_at: string };
    people: { id: string; name: string }[];
    expenses: {
      id: string;
      name: string;
      amount: number;
      payer_id: string | null;
      shares: { person_id: string; weight: number; extra: number }[];
    }[];
    photos: { id: string; expense_id: string | null; bytes: number; w: number; h: number; created_at: string }[];
    repayments?: { from_person: string; to_person: string; amount_paid: number }[];
  };

  return {
    role: raw.role,
    party: {
      id: raw.party.id,
      title: raw.party.title,
      date: raw.party.party_date,
      currencyCode: raw.party.currency_code,
      people: (raw.people ?? []).map((p) => ({ id: p.id, name: p.name })),
      items: (raw.expenses ?? []).map((e) => {
        const weights: Record<string, number> = {};
        const extras: Record<string, number> = {};
        for (const s of e.shares ?? []) {
          if (s.weight !== 1) weights[s.person_id] = s.weight;
          if (s.extra) extras[s.person_id] = Number(s.extra);
        }
        return {
          id: e.id,
          name: e.name,
          amount: Number(e.amount),
          payerId: e.payer_id,
          bearerIds: (e.shares ?? []).map((s) => s.person_id),
          weights,
          extras,
        };
      }),
      photos: (raw.photos ?? []).map((p) => ({
        id: p.id,
        expenseId: p.expense_id,
        bytes: p.bytes,
        w: p.w,
        h: p.h,
        addedAt: new Date(p.created_at).getTime(),
      })),
      repayments: Object.fromEntries(
        (raw.repayments ?? []).map((r) => [`${r.from_person}>${r.to_person}`, Number(r.amount_paid)]),
      ),
      createdAt: new Date(raw.party.created_at).getTime(),
      updatedAt: new Date(raw.party.updated_at).getTime(),
    },
  };
}

/** Push changes made by someone holding an edit link. The database re-checks the role. */
/** What this link lets the current visitor do — which depends on being signed in. */
export async function shareCapability(token: string): Promise<'none' | 'view' | 'view_until_signed_in' | 'edit'> {
  const db = supabase();
  if (!db) return 'none';
  const { data, error } = await db.rpc('share_capability', { tok: token });
  if (error) return 'none';
  return (data as 'none' | 'view' | 'view_until_signed_in' | 'edit') ?? 'none';
}

export async function writeSharedParty(token: string, ops: RowOp[]): Promise<void> {
  const db = supabase();
  if (!db || ops.length === 0) return;

  const payload = ops
    .filter(
      (o) =>
        o.table === 'expenses' ||
        o.table === 'expense_shares' ||
        o.table === 'party_people' ||
        o.table === 'repayments',
    )
    .map((o) => {
      if (o.table === 'expenses' && o.op === 'upsert') {
        return { table: o.table, op: o.op, id: o.id, order: o.order, item: o.item };
      }
      return o;
    });

  const { error } = await db.rpc('share_write', { tok: token, ops: payload });
  if (error) throw error;
}

/* ── who is on an event, and what they did ───────────────────────── */

export type EventPerson = {
  userId: string;
  name: string;
  avatar: string | null;
  isOwner: boolean;
  isBanned: boolean;
};

export type LogEntry = {
  id: number;
  actorId: string | null;
  actorName: string;
  action: string;
  subject: string;
  amount: number | null;
  at: number;
};

export async function listEventAccess(partyId: string): Promise<EventPerson[]> {
  const { data, error } = await client().rpc('event_access', { p_party_id: partyId });
  if (error) throw error;

  return ((data ?? []) as {
    user_id: string;
    display_name: string;
    avatar_url: string | null;
    is_owner: boolean;
    is_banned: boolean;
  }[]).map((r) => ({
    userId: r.user_id,
    name: r.display_name,
    avatar: r.avatar_url,
    isOwner: r.is_owner,
    isBanned: r.is_banned,
  }));
}

export async function setEventBan(partyId: string, userId: string, banned: boolean): Promise<void> {
  const { error } = await client().rpc('set_event_ban', {
    p_party_id: partyId,
    p_user_id: userId,
    p_banned: banned,
  });
  if (error) throw error;
}

export async function listEventLog(partyId: string, limit = 80): Promise<LogEntry[]> {
  const { data, error } = await client()
    .from('event_log')
    .select('id, actor_id, actor_name, action, subject, amount, at')
    .eq('party_id', partyId)
    .order('at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  return ((data ?? []) as {
    id: number;
    actor_id: string | null;
    actor_name: string;
    action: string;
    subject: string;
    amount: number | null;
    at: string;
  }[]).map((r) => ({
    id: r.id,
    actorId: r.actor_id,
    actorName: r.actor_name,
    action: r.action,
    subject: r.subject,
    amount: r.amount === null ? null : Number(r.amount),
    at: new Date(r.at).getTime(),
  }));
}
