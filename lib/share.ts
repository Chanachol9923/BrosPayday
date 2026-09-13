import type { Party, Person, Item } from './types';
import { uid } from './format';
import { newParty, todayISO } from './store';

/**
 * name, amount, payer index, bearer indexes, weights, and — only when somebody
 * had an amount of their own — what each of them carried alone. The last slot is
 * absent in links made before that existed, which decode as nobody having any.
 */
type PackedItem = [string, number, number, number[], number[], number[]?];

type Packed = {
  /** Absent on links made before profiles and dates existed. */
  v?: number;
  t: string;
  d?: string;
  c: string;
  b?: string;
  p: string[];
  i: PackedItem[];
};

export type SharedParty = {
  party: Party;
  /** Whoever pressed Share, if their link carried a name. */
  sharedBy: string | null;
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
export function encodeParty(party: Party, sharedBy?: string | null): string {
  const index = new Map(party.people.map((p, i) => [p.id, i] as const));

  const packed: Packed = {
    v: 3,
    t: party.title,
    d: party.date,
    c: party.currencyCode,
    p: party.people.map((p) => p.name),
    i: party.items.map((item): PackedItem => {
      const kept = item.bearerIds.filter((id) => index.has(id));
      const extras = kept.map((id) => item.extras?.[id] ?? 0);
      const row: PackedItem = [
        item.name,
        item.amount,
        item.payerId !== null ? index.get(item.payerId) ?? -1 : -1,
        kept.map((id) => index.get(id) as number),
        kept.map((id) => item.weights?.[id] ?? 1),
      ];
      // Left out entirely when there is nothing to say, so ordinary splits keep
      // making short links.
      if (extras.some((v) => v > 0)) row.push(extras);
      return row;
    }),
  };

  const by = sharedBy?.trim();
  if (by) packed.b = by;

  return b64encode(JSON.stringify(packed));
}

export function decodeParty(code: string): SharedParty | null {
  try {
    const packed = JSON.parse(b64decode(code)) as Packed;
    if (!packed || !Array.isArray(packed.p) || !Array.isArray(packed.i)) return null;

    const people: Person[] = packed.p.map((name) => ({ id: uid(), name: String(name ?? '') }));

    const items: Item[] = packed.i.map((row) => {
      const [name, amount, payerIdx, bearerIdxs, weightList, extraList] =
        row ?? ([] as unknown as PackedItem);

      const bearerIds: string[] = [];
      const seen = new Set<string>();
      for (const idx of bearerIdxs ?? []) {
        const id = people[idx]?.id;
        if (id && !seen.has(id)) {
          seen.add(id);
          bearerIds.push(id);
        }
      }

      const weights: Record<string, number> = {};
      const extras: Record<string, number> = {};
      (bearerIdxs ?? []).forEach((idx, i) => {
        const id = people[idx]?.id;
        if (!id) return;
        const w = weightList?.[i];
        if (Number.isFinite(w) && w > 0 && w !== 1) weights[id] = w;
        const e = extraList?.[i];
        if (Number.isFinite(e) && (e as number) > 0) extras[id] = Math.round(e as number);
      });

      return {
        id: uid(),
        name: String(name ?? ''),
        amount: Number.isFinite(amount) ? Math.round(amount) : 0,
        payerId: people[payerIdx]?.id ?? null,
        bearerIds,
        weights,
        extras,
      };
    });

    const blank = newParty(String(packed.c ?? 'THB'));

    return {
      party: {
        ...blank,
        title: String(packed.t ?? ''),
        date: typeof packed.d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(packed.d) ? packed.d : todayISO(),
        currencyCode: String(packed.c ?? 'THB'),
        people,
        items,
      },
      sharedBy: typeof packed.b === 'string' && packed.b.trim() ? packed.b.trim() : null,
    };
  } catch {
    return null;
  }
}

export const SHARE_PREFIX = '#p=';

export function buildShareUrl(party: Party, sharedBy?: string | null): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}${SHARE_PREFIX}${encodeParty(party, sharedBy)}`;
}

/** Reads a shared party out of the address bar, accepting the older `#s=` links too. */
export function readShareHash(hash: string): SharedParty | null {
  if (hash.startsWith(SHARE_PREFIX)) return decodeParty(hash.slice(SHARE_PREFIX.length));
  if (hash.startsWith('#s=')) return decodeParty(hash.slice(3));
  return null;
}

/* ── live event codes ──────────────────────────────────────────────────────
 *
 * Not a snapshot in a URL like the above, but a short code the server hands out
 * for one event. Both the button at the top of the share sheet and the card
 * further down are built from these, and they have to be the same link — the two
 * are described to people as one thing, and revoking one revokes the other.
 */

export type EventCode = { token: string; role: 'view' | 'edit' };

/** The address you send someone, for a code of either kind. */
export function eventCodeUrl(origin: string, token: string): string {
  return `${origin}/?s=${token}`;
}

/**
 * The codes to show, given what the server listed and the codes just made sure of.
 *
 * Opening the sheet does two things: mints the codes the buttons hand out, and
 * lists what exists. If a listing were to come back without one that was just
 * made, a button at the top would be working while the card below claimed there
 * was no code yet — one link, described two ways, disagreeing. This folds the
 * known ones back in, and never lets a role appear twice. What the server listed
 * always wins; nothing here overrides it.
 */
export function withCodes(listed: EventCode[], minted: EventCode[]): EventCode[] {
  const out = [...listed];
  for (const code of minted) {
    if (code.token && !out.some((l) => l.role === code.role)) out.push(code);
  }
  return out;
}
