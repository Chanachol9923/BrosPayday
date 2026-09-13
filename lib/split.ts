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

export type ItemBreakdown = {
  item: Item;
  payer: Person | null;
  bearers: Person[];
  /** personId -> minor units this person owes for this item */
  perPerson: Record<string, number>;
  /** true when every bearer carries the same amount */
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
    const bearers = item.bearerIds.map((id) => byId.get(id)).filter((p): p is Person => !!p);
    const payer = item.payerId ? byId.get(item.payerId) ?? null : null;

    if (!payer) itemProblems.push('No one is marked as having paid for this.');
    if (bearers.length === 0) itemProblems.push('No one is sharing this expense.');
    if (item.amount <= 0) itemProblems.push('Amount must be greater than zero.');

    const weights = bearers.map((p) => {
      const w = item.weights?.[p.id];
      return Number.isFinite(w) && (w as number) > 0 ? (w as number) : 1;
    });
    const parts = allocate(item.amount, weights);

    const perPerson: Record<string, number> = {};
    bearers.forEach((p, i) => {
      perPerson[p.id] = (perPerson[p.id] ?? 0) + parts[i];
    });

    const sum = parts.reduce((a, b) => a + b, 0);
    const exact = sum === item.amount;

    if (payer) paid[payer.id] = (paid[payer.id] ?? 0) + item.amount;
    for (const p of bearers) owed[p.id] = (owed[p.id] ?? 0) + (perPerson[p.id] ?? 0);
    total += item.amount;

    const even = parts.length > 0 && parts.every((v) => v === parts[0]);

    breakdowns.push({
      item,
      payer,
      bearers,
      perPerson,
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
      detail: 'Each expense is divided down to the last unit — nothing is rounded away.',
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
