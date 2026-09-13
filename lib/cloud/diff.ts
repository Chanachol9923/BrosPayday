import type { Party, Payee, Person, PhotoMeta, Preset, Item } from '../types';

/**
 * Turning a changed app state into row-level database writes.
 *
 * The app edits whole parties in memory. Sending a whole party to the database on
 * every keystroke would mean last-write-wins, and two people settling the same
 * night would silently overwrite each other — exactly the argument this app exists
 * to prevent. So a change is reduced to the smallest set of row operations that
 * produces it, and two people touching different expenses never collide.
 *
 * This is deliberately pure: no network, no client, no clock. It is the part of
 * cloud sync that can be proven without a database to talk to.
 */

export type RowOp =
  | { table: 'parties'; op: 'upsert'; id: string; party: Party }
  | { table: 'parties'; op: 'delete'; id: string }
  | { table: 'party_people'; op: 'upsert'; id: string; partyId: string; name: string; order: number }
  | { table: 'party_people'; op: 'delete'; id: string }
  | { table: 'expenses'; op: 'upsert'; id: string; partyId: string; item: Item; order: number }
  | { table: 'expenses'; op: 'delete'; id: string }
  | { table: 'expense_shares'; op: 'replace'; expenseId: string; shares: { personId: string; weight: number }[] }
  | { table: 'photos'; op: 'upsert'; id: string; partyId: string; photo: PhotoMeta }
  | { table: 'photos'; op: 'delete'; id: string }
  | { table: 'presets'; op: 'upsert'; id: string; preset: Preset }
  | { table: 'presets'; op: 'delete'; id: string }
  | { table: 'payees'; op: 'upsert'; key: string; payee: Payee }
  | { table: 'payees'; op: 'delete'; key: string };

const byId = <T extends { id: string }>(list: readonly T[]): Map<string, T> =>
  new Map(list.map((x) => [x.id, x]));

function partyMetaChanged(a: Party, b: Party): boolean {
  return a.title !== b.title || a.date !== b.date || a.currencyCode !== b.currencyCode;
}

function peopleOps(prev: Party | null, next: Party): RowOp[] {
  const ops: RowOp[] = [];
  const before = byId<Person>(prev?.people ?? []);
  const after = byId<Person>(next.people);

  next.people.forEach((person, order) => {
    const old = before.get(person.id);
    const movedOrRenamed =
      !old || old.name !== person.name || (prev?.people.findIndex((p) => p.id === person.id) ?? -1) !== order;
    if (movedOrRenamed) {
      ops.push({ table: 'party_people', op: 'upsert', id: person.id, partyId: next.id, name: person.name, order });
    }
  });

  for (const person of prev?.people ?? []) {
    if (!after.has(person.id)) ops.push({ table: 'party_people', op: 'delete', id: person.id });
  }

  return ops;
}

function sharesOf(item: Item): { personId: string; weight: number }[] {
  return item.bearerIds.map((id) => ({ personId: id, weight: item.weights?.[id] ?? 1 }));
}

function sharesEqual(a: Item, b: Item): boolean {
  const left = sharesOf(a);
  const right = sharesOf(b);
  if (left.length !== right.length) return false;
  return left.every((s, i) => s.personId === right[i].personId && s.weight === right[i].weight);
}

function expenseOps(prev: Party | null, next: Party): RowOp[] {
  const ops: RowOp[] = [];
  const before = byId<Item>(prev?.items ?? []);
  const after = byId<Item>(next.items);

  next.items.forEach((item, order) => {
    const old = before.get(item.id);
    const positionChanged = (prev?.items.findIndex((i) => i.id === item.id) ?? -1) !== order;

    if (!old || old.name !== item.name || old.amount !== item.amount || old.payerId !== item.payerId || positionChanged) {
      ops.push({ table: 'expenses', op: 'upsert', id: item.id, partyId: next.id, item, order });
    }
    if (!old || !sharesEqual(old, item)) {
      ops.push({ table: 'expense_shares', op: 'replace', expenseId: item.id, shares: sharesOf(item) });
    }
  });

  for (const item of prev?.items ?? []) {
    if (!after.has(item.id)) ops.push({ table: 'expenses', op: 'delete', id: item.id });
  }

  return ops;
}

function photoOps(prev: Party | null, next: Party): RowOp[] {
  const ops: RowOp[] = [];
  const before = byId<PhotoMeta>(prev?.photos ?? []);
  const after = byId<PhotoMeta>(next.photos ?? []);

  for (const photo of next.photos ?? []) {
    const old = before.get(photo.id);
    if (!old || old.expenseId !== photo.expenseId) {
      ops.push({ table: 'photos', op: 'upsert', id: photo.id, partyId: next.id, photo });
    }
  }

  for (const photo of prev?.photos ?? []) {
    if (!after.has(photo.id)) ops.push({ table: 'photos', op: 'delete', id: photo.id });
  }

  return ops;
}

/** Every row operation needed to turn `prev` into `next` for one party. */
export function diffParty(prev: Party | null, next: Party | null): RowOp[] {
  if (!next) return prev ? [{ table: 'parties', op: 'delete', id: prev.id }] : [];

  const ops: RowOp[] = [];

  // A different id is a different party; the old one is not deleted here because
  // it has usually just moved to history rather than gone away.
  const sameParty = prev && prev.id === next.id ? prev : null;

  if (!sameParty || partyMetaChanged(sameParty, next)) {
    ops.push({ table: 'parties', op: 'upsert', id: next.id, party: next });
  }

  ops.push(...peopleOps(sameParty, next));
  ops.push(...expenseOps(sameParty, next));
  ops.push(...photoOps(sameParty, next));

  return ops;
}

function presetOps(prev: readonly Preset[], next: readonly Preset[]): RowOp[] {
  const ops: RowOp[] = [];
  const before = byId(prev);
  const after = byId(next);

  for (const preset of next) {
    const old = before.get(preset.id);
    if (!old || JSON.stringify(old) !== JSON.stringify(preset)) {
      ops.push({ table: 'presets', op: 'upsert', id: preset.id, preset });
    }
  }
  for (const preset of prev) {
    if (!after.has(preset.id)) ops.push({ table: 'presets', op: 'delete', id: preset.id });
  }
  return ops;
}

function payeeOps(prev: Record<string, Payee>, next: Record<string, Payee>): RowOp[] {
  const ops: RowOp[] = [];

  for (const [key, payee] of Object.entries(next)) {
    const old = prev[key];
    if (!old || old.promptPayId !== payee.promptPayId || old.qrPhotoId !== payee.qrPhotoId || old.name !== payee.name) {
      ops.push({ table: 'payees', op: 'upsert', key, payee });
    }
  }
  for (const key of Object.keys(prev)) {
    if (!next[key]) ops.push({ table: 'payees', op: 'delete', key });
  }
  return ops;
}

export type GroupSlice = {
  current: Party | null;
  history: readonly Party[];
  presets: readonly Preset[];
  payees: Record<string, Payee>;
};

/**
 * Everything that changed in one group, as row operations. Parties that only moved
 * between the workbench and history are matched by id across both lists, so an
 * archive is a single flag flip rather than a delete and a re-insert.
 */
export function diffGroup(prev: GroupSlice, next: GroupSlice): RowOp[] {
  const ops: RowOp[] = [];

  // Archived is a position, not a field on the party: a party is archived when it
  // is in history rather than on the workbench, so moving it flips one column.
  const index = (slice: GroupSlice) => {
    const map = new Map<string, { party: Party; archived: boolean }>();
    if (slice.current) map.set(slice.current.id, { party: slice.current, archived: false });
    for (const party of slice.history) map.set(party.id, { party, archived: true });
    return map;
  };

  const prevParties = index(prev);
  const nextParties = index(next);

  for (const [id, entry] of nextParties) {
    const old = prevParties.get(id);
    const partyOps = diffParty(old?.party ?? null, entry.party);

    // The party row itself has to go up when only its archived flag moved.
    if (old && old.archived !== entry.archived && !partyOps.some((o) => o.table === 'parties' && o.op === 'upsert')) {
      partyOps.unshift({ table: 'parties', op: 'upsert', id, party: entry.party });
    }
    ops.push(...partyOps);
  }
  for (const id of prevParties.keys()) {
    if (!nextParties.has(id)) ops.push({ table: 'parties', op: 'delete', id });
  }

  ops.push(...presetOps(prev.presets, next.presets));
  ops.push(...payeeOps(prev.payees, next.payees));

  return ops;
}
