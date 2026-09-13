import type { EventState, Item, Person } from './types';

/**
 * Split `amount` (integer minor units) across `weights` using the largest-remainder
 * method, so the parts always add back up to exactly `amount` — no lost or invented
 * satang. All arithmetic is integer-only; nothing here can drift with floats.
 */
export function allocate(amount: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];

  const safe = weights.map((w) => (Number.isFinite(w) && w > 0 ? Math.round(w) : 0));
  const totalWeight = safe.reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) return new Array(n).fill(0);

  const sign = amount < 0 ? -1 : 1;
  const abs = Math.abs(amount);

  const base: number[] = new Array(n);
  const rema: number[] = new Array(n);
  let assigned = 0;

  for (let i = 0; i < n; i++) {
    const numerator = abs * safe[i];
    const q = Math.floor(numerator / totalWeight);
    base[i] = q;
    rema[i] = numerator - q * totalWeight; // exact integer remainder
    assigned += q;
  }

  // Hand the leftover minor units to the largest remainders first (ties -> lower index).
  let leftover = abs - assigned;
  const order = rema
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r - a.r || a.i - b.i);

  for (let k = 0; leftover > 0 && k < order.length; k++, leftover--) {
    base[order[k].i] += 1;
  }

  return base.map((v) => v * sign);
}

/** One bearer's terms for an expense: how much is theirs alone, then their share of the rest. */
export type Terms = {
  /** Share of whatever is left after the personal amounts come off. Missing means 1. */
  weight: number;
  /** An exact amount in minor units this person carries alone. Missing means 0. */
  extra: number;
};

export type ShareOut = {
  /** What each person owes in the end: their own amount plus their share of the rest. */
  parts: number[];
  /** The personal amounts, after junk has been cleaned out of them. */
  extras: number[];
  extraTotal: number;
  /** What was left to divide once the personal amounts came off. Can be negative. */
  rest: number;
  /** Each person's slice of that remainder. */
  shared: number[];
};

/**
 * Divide one expense among the people sharing it.
 *
 * Two things happen, in this order. Anything a person is carrying alone — "the
 * karaoke was 300 but A ate 20 of snacks" — comes off the top and goes straight
 * to them. Whatever is left is divided by weight, to the last satang, by the
 * largest-remainder method.
 *
 * The guarantee, whatever is thrown at it: the parts add up to `amount` exactly.
 * That holds even when the personal amounts come to more than the expense, in
 * which case the remainder is negative and is shared out as a credit — wrong as
 * an intention, but never money invented or lost. computeSplit flags that case;
 * the arithmetic itself stays honest either way.
 *
 * This is the only place an expense is divided. The engine, the live preview in
 * the expense sheet, and the proof all call it, so they cannot drift apart.
 */
export function shareOut(amount: number, entries: Terms[]): ShareOut {
  const total = Number.isFinite(amount) ? Math.round(amount) : 0;
  if (entries.length === 0) {
    return { parts: [], extras: [], extraTotal: 0, rest: total, shared: [] };
  }

  const extras = entries.map((e) =>
    Number.isFinite(e.extra) && e.extra > 0 ? Math.round(e.extra) : 0,
  );
  const extraTotal = extras.reduce((a, b) => a + b, 0);
  const rest = total - extraTotal;

  // A weight of zero or nonsense reads as one share: everybody named here is
  // taking part, so nobody silently drops out of the division.
  const weights = entries.map((e) =>
    Number.isFinite(e.weight) && e.weight > 0 ? Math.round(e.weight) : 1,
  );
  const shared = allocate(rest, weights);

  return { parts: extras.map((own, i) => own + shared[i]), extras, extraTotal, rest, shared };
}

export type ItemBreakdown = {
  item: Item;
  payer: Person | null;
  bearers: Person[];
  /** personId -> minor units this person owes for this item */
  perPerson: Record<string, number>;
  /** personId -> the part of that they carry alone, before anything is divided */
  extras: Record<string, number>;
  /** the sum of those personal amounts */
  extraTotal: number;
  /** what was left to divide after they came off */
  rest: number;
  /** true when every bearer carries the same amount and nobody had extras */
  even: boolean;
  evenShare: number;
  /** allocation adds up exactly to the item amount */
  exact: boolean;
  /** paid by one person, borne entirely by a different single person */
  isTreat: boolean;
  problems: string[];
};

export type Transfer = {
  fromId: string;
  toId: string;
  amount: number;
};

/** How a repayment is addressed: the pair it belongs to, not the amount. */
export function repaymentKey(fromId: string, toId: string): string {
  return `${fromId}>${toId}`;
}

export type RepaymentView = {
  /** How much of this payment has been handed over, as far as anyone can be held to it. */
  paid: number;
  /** What is still outstanding. Never negative. */
  left: number;
  done: boolean;
};

/**
 * One suggested payment, read against what has already been repaid.
 *
 * The stored figure is not taken on trust: it can outlive the debt it was recorded
 * against — an expense gets corrected, someone is taken off the split, a share link
 * arrives hand-edited — and a repayment larger than the payment must show as
 * "nothing left", never as a negative amount owed. Note that this only changes what
 * the settle-up row *says*; the split itself never sees it, so the proof keeps
 * describing the same arithmetic no matter what anyone types here.
 */
export function repaymentView(amount: number, paid: number): RepaymentView {
  const due = Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
  const given = Number.isFinite(paid) ? Math.max(0, Math.round(paid)) : 0;
  const settled = Math.min(given, due);
  return { paid: settled, left: due - settled, done: due > 0 && settled === due };
}

export type Check = {
  label: string;
  ok: boolean;
  detail: string;
};

export type SplitResult = {
  breakdowns: ItemBreakdown[];
  paid: Record<string, number>;
  owed: Record<string, number>;
  net: Record<string, number>;
  total: number;
  totalOwed: number;
  transfers: Transfer[];
  checks: Check[];
  balanced: boolean;
  problems: string[];
};

function emptyLedger(people: Person[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of people) out[p.id] = 0;
  return out;
}

export function computeSplit(state: EventState): SplitResult {
  const { people, items } = state;
  const byId = new Map(people.map((p) => [p.id, p] as const));

  const paid = emptyLedger(people);
  const owed = emptyLedger(people);
  const breakdowns: ItemBreakdown[] = [];
  const problems: string[] = [];

  let total = 0;

  for (const item of items) {
    const itemProblems: string[] = [];

    // Unknown ids are dropped and repeats collapsed: a hand-edited share link or a
    // stale saved party must never let one person be charged for the same item twice.
    const bearers: Person[] = [];
    const seenBearer = new Set<string>();
    for (const id of item.bearerIds) {
      const person = byId.get(id);
      if (person && !seenBearer.has(person.id)) {
        seenBearer.add(person.id);
        bearers.push(person);
      }
    }

    const payer = item.payerId ? byId.get(item.payerId) ?? null : null;

    if (!payer) itemProblems.push('No one is marked as having paid for this.');
    if (bearers.length === 0) itemProblems.push('No one is sharing this expense.');
    if (item.amount <= 0) itemProblems.push('Amount must be greater than zero.');

    const { parts, extras, extraTotal, rest } = shareOut(
      item.amount,
      bearers.map((p) => ({
        weight: item.weights?.[p.id] ?? 1,
        // Only people actually sharing this expense can carry a part of it alone.
        // An amount left over for somebody since removed is dropped, exactly as a
        // stale bearer id is, rather than charged to a person who is not on it.
        extra: item.extras?.[p.id] ?? 0,
      })),
    );

    if (extraTotal > item.amount && item.amount > 0) {
      itemProblems.push(
        'The amounts set aside for individuals come to more than the expense itself.',
      );
    }

    const perPerson: Record<string, number> = {};
    const extraOf: Record<string, number> = {};
    bearers.forEach((p, i) => {
      perPerson[p.id] = parts[i];
      if (extras[i] > 0) extraOf[p.id] = extras[i];
    });

    const sum = parts.reduce((a, b) => a + b, 0);
    const exact = sum === item.amount;

    if (payer) paid[payer.id] = (paid[payer.id] ?? 0) + item.amount;
    for (const p of bearers) owed[p.id] = (owed[p.id] ?? 0) + (perPerson[p.id] ?? 0);
    total += item.amount;

    const even = extraTotal === 0 && parts.length > 0 && parts.every((v) => v === parts[0]);

    breakdowns.push({
      item,
      payer,
      bearers,
      perPerson,
      extras: extraOf,
      extraTotal,
      rest,
      even,
      evenShare: even ? parts[0] : 0,
      exact,
      isTreat: !!payer && bearers.length === 1 && bearers[0].id !== payer.id,
      problems: itemProblems,
    });

    for (const p of itemProblems) problems.push(`“${item.name || 'Untitled'}”: ${p}`);
  }

  const net = emptyLedger(people);
  for (const p of people) net[p.id] = (paid[p.id] ?? 0) - (owed[p.id] ?? 0);

  const totalOwed = people.reduce((a, p) => a + (owed[p.id] ?? 0), 0);
  const netSum = people.reduce((a, p) => a + (net[p.id] ?? 0), 0);

  const transfers = settle(net, people);

  // Replay the transfers on top of the balances: everyone must land on exactly zero.
  const afterSettle = { ...net };
  for (const t of transfers) {
    afterSettle[t.fromId] += t.amount;
    afterSettle[t.toId] -= t.amount;
  }
  const settlesClean = people.every((p) => (afterSettle[p.id] ?? 0) === 0);

  const checks: Check[] = [
    {
      label: 'Every expense is fully allocated',
      ok: breakdowns.every((b) => b.exact),
      detail:
        'Each expense is divided down to the last unit — personal amounts included, nothing rounded away.',
    },
    {
      label: 'Total shared equals total spent',
      ok: totalOwed === total,
      detail: 'The sum of everyone’s share is identical to the money that actually left the table.',
    },
    {
      label: 'All balances cancel out',
      ok: netSum === 0,
      detail: 'What is owed to people and what is owed by people is the same number.',
    },
    {
      label: 'Transfers bring everyone to zero',
      ok: settlesClean,
      detail: 'Replaying the payments below leaves every single person square.',
    },
  ];

  return {
    breakdowns,
    paid,
    owed,
    net,
    total,
    totalOwed,
    transfers,
    checks,
    balanced: checks.every((c) => c.ok) && problems.length === 0,
    problems,
  };
}

/**
 * Greedy settlement: repeatedly match the biggest debtor against the biggest creditor.
 * Never needs more than (people - 1) payments, and usually far fewer.
 */
export function settle(net: Record<string, number>, people: Person[]): Transfer[] {
  const creditors = people
    .filter((p) => (net[p.id] ?? 0) > 0)
    .map((p) => ({ id: p.id, amount: net[p.id] }))
    .sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));

  const debtors = people
    .filter((p) => (net[p.id] ?? 0) < 0)
    .map((p) => ({ id: p.id, amount: -net[p.id] }))
    .sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));

  const transfers: Transfer[] = [];
  let ci = 0;
  let di = 0;
  let guard = 0;

  while (ci < creditors.length && di < debtors.length && guard++ < 10000) {
    const credit = creditors[ci];
    const debt = debtors[di];
    const amount = Math.min(credit.amount, debt.amount);

    if (amount > 0) transfers.push({ fromId: debt.id, toId: credit.id, amount });

    credit.amount -= amount;
    debt.amount -= amount;
    if (credit.amount === 0) ci++;
    if (debt.amount === 0) di++;
  }

  return transfers.sort((a, b) => b.amount - a.amount);
}
