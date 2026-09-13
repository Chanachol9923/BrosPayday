import type { EventState, Item, Person } from './types';
import { uid } from './format';

type Packed = {
  t: string;
  c: string;
  p: string[];
  i: [string, number, number, number[], number[]][];
};

function b64encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64decode(text: string): string {
  const normalised = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** People become array indexes, so a whole party fits in a link you can paste in chat. */
export function encodeState(state: EventState): string {
  const index = new Map(state.people.map((p, i) => [p.id, i] as const));
  const packed: Packed = {
    t: state.title,
    c: state.currencyCode,
    p: state.people.map((p) => p.name),
    i: state.items.map((item) => {
      const bearers = item.bearerIds
        .map((id) => index.get(id))
        .filter((v): v is number => v !== undefined);
      return [
        item.name,
        item.amount,
        item.payerId !== null ? index.get(item.payerId) ?? -1 : -1,
        bearers,
        item.bearerIds
          .filter((id) => index.has(id))
          .map((id) => item.weights?.[id] ?? 1),
      ];
    }),
  };
  return b64encode(JSON.stringify(packed));
}

export function decodeState(code: string): EventState | null {
  try {
    const packed = JSON.parse(b64decode(code)) as Packed;
    if (!packed || !Array.isArray(packed.p) || !Array.isArray(packed.i)) return null;

    const people: Person[] = packed.p.map((name) => ({ id: uid('p'), name: String(name) }));

    const items: Item[] = packed.i.map((row) => {
      const [name, amount, payerIdx, bearerIdxs, weightList] = row;
      const bearerIds = (bearerIdxs ?? [])
        .map((i) => people[i]?.id)
        .filter((v): v is string => !!v);

      const weights: Record<string, number> = {};
      bearerIds.forEach((id, i) => {
        const w = weightList?.[i];
        if (Number.isFinite(w) && w > 0 && w !== 1) weights[id] = w;
      });

      return {
        id: uid('i'),
        name: String(name ?? ''),
        amount: Number.isFinite(amount) ? Math.round(amount) : 0,
        payerId: people[payerIdx]?.id ?? null,
        bearerIds,
        weights,
      };
    });

    return {
      title: String(packed.t ?? 'Untitled'),
      currencyCode: String(packed.c ?? 'THB'),
      people,
      items,
    };
  } catch {
    return null;
  }
}

export const STORAGE_KEY = 'brospayday.state.v1';

export function loadLocal(): EventState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EventState;
    if (!parsed || !Array.isArray(parsed.people) || !Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveLocal(state: EventState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* private mode / quota — running without persistence is fine */
  }
}
