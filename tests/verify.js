/**
 * Correctness suite for the money maths. Run with `npm run verify`.
 *
 * The point of this file is that nobody has to take the split on faith. It checks
 * the invariants that actually matter — shares add up to the bill, balances cancel,
 * settling leaves everyone on zero — across hundreds of thousands of generated
 * parties, plus the edge cases a real user (or a hand-edited share link) can reach.
 */

const {
  computeSplit, allocate, repaymentKey, repaymentView, shareOut,
} = require('../.verify/split.js');
const { parseAmount, formatMoney, rescaleAmount } = require('../.verify/format.js');
const { encodeParty, decodeParty } = require('../.verify/share.js');
const {
  applyPreset, archiveCurrent, deleteFromHistory, emptyStore, newParty,
  presetFromParty, referencedPhotoIds, reopenFromHistory,
  setPayee, payeeFor, hasPaymentDetails, addPhotoMeta, updateCurrent,
} = require('../.verify/store.js');
const { referenceParty } = require('./fixture.js');
const { diffParty, diffGroup } = require('../.verify/cloud/diff.js');
const {
  buildPromptPayPayload, crc16, parsePromptPayId, parseTlv, verifyPromptPayPayload,
} = require('../.verify/promptpay.js');

let fails = 0;
const fail = (msg) => {
  console.log('  FAIL  ' + msg);
  fails++;
};
const ok = (label) => console.log('  ok    ' + label);
const section = (name) => console.log('\n' + name);

// Deterministic PRNG (xorshift32) so any failure is reproducible from the seed.
let seed = 0x2f6e2b1;
const rnd = () => {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >> 17;
  seed ^= seed << 5;  seed >>>= 0;
  return seed / 0x100000000;
};
const ri = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

section('allocate — exhaustive, equal weights');
{
  let bad = 0;
  for (let amt = 0; amt <= 1000; amt++) {
    for (let n = 1; n <= 8; n++) {
      const parts = allocate(amt, new Array(n).fill(1));
      if (parts.reduce((a, b) => a + b, 0) !== amt) bad++;
      if (Math.max(...parts) - Math.min(...parts) > 1) bad++;
      if (parts.some((p) => p < 0)) bad++;
    }
  }
  bad
    ? fail(`${bad} equal-split violations`)
    : ok('8,008 equal splits: sum exact, nobody more than 1 unit above anyone else');
}

section('allocate — randomised weights');
{
  let bad = 0;
  for (let t = 0; t < 200000; t++) {
    const n = ri(1, 9);
    const w = Array.from({ length: n }, () => ri(1, 20));
    const amt = ri(0, 5_000_000);
    const parts = allocate(amt, w);
    const totalWeight = w.reduce((a, b) => a + b, 0);

    if (parts.reduce((a, b) => a + b, 0) !== amt) { bad++; continue; }
    if (parts.some((p) => p < 0)) { bad++; continue; }

    let broke = false;
    for (let i = 0; i < n && !broke; i++) {
      const ideal = (amt * w[i]) / totalWeight;
      if (parts[i] < Math.floor(ideal) || parts[i] > Math.floor(ideal) + 1) broke = true;
    }
    for (let i = 0; i < n && !broke; i++) {
      for (let j = 0; j < n && !broke; j++) {
        if (w[i] > w[j] && parts[i] < parts[j]) broke = true;
      }
    }
    if (broke) bad++;
  }
  bad
    ? fail(`${bad} weighted violations`)
    : ok('200,000 weighted splits: exact, within 1 unit of ideal, a bigger share never pays less');
}

section('allocate — degenerate input');
{
  const cases = [
    [allocate(-300, [1, 1]), [-150, -150], 'negative amount splits negatively'],
    [allocate(100, []), [], 'no bearers returns empty'],
    [allocate(100, [0, 0]), [0, 0], 'all-zero weights give zeros, never NaN'],
    [allocate(0, [1, 1, 1]), [0, 0, 0], 'zero amount gives zeros'],
    [allocate(7, [1]), [7], 'a single bearer takes the lot'],
  ];
  let bad = 0;
  for (const [got, want, label] of cases) {
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
      bad++;
    }
  }
  if (!bad) ok('5 degenerate inputs handled without NaN or loss');
}

section('computeSplit — randomised parties');
{
  let bad = 0;
  let maxTransfers = 0;
  const runs = 20000;

  for (let t = 0; t < runs; t++) {
    const nPeople = ri(1, 8);
    const people = Array.from({ length: nPeople }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
    const items = [];

    for (let k = 0, nItems = ri(0, 10); k < nItems; k++) {
      const bearerIds = people.filter(() => rnd() < 0.6).map((p) => p.id);
      if (bearerIds.length === 0) bearerIds.push(people[ri(0, nPeople - 1)].id);

      const weights = {};
      if (rnd() < 0.3) for (const id of bearerIds) weights[id] = ri(1, 5);

      const amount = ri(1, 2_000_000);

      // Amounts people carry alone. Deliberately allowed to overshoot the expense
      // sometimes: that is wrong as an intention, but the arithmetic still has to
      // add up to the bill exactly rather than invent or lose a satang.
      const extras = {};
      if (rnd() < 0.3) {
        const ceiling = rnd() < 0.15 ? amount : Math.floor(amount / bearerIds.length);
        for (const id of bearerIds) if (rnd() < 0.6) extras[id] = ri(0, Math.max(1, ceiling));
      }

      items.push({
        id: `i${k}`,
        name: `item${k}`,
        amount,
        payerId: people[ri(0, nPeople - 1)].id,
        bearerIds,
        weights,
        extras,
      });
    }

    const r = computeSplit({ title: 't', currencyCode: 'THB', people, items });
    const sumOwed = people.reduce((a, p) => a + r.owed[p.id], 0);
    const sumNet = people.reduce((a, p) => a + r.net[p.id], 0);

    if (sumOwed !== r.total) { fail(`run ${t}: shares ${sumOwed} != spent ${r.total}`); bad++; continue; }
    if (sumNet !== 0) { fail(`run ${t}: balances sum to ${sumNet}, not 0`); bad++; continue; }
    if (r.transfers.some((x) => x.amount <= 0)) { fail(`run ${t}: a transfer was not positive`); bad++; continue; }
    if (r.transfers.some((x) => x.fromId === x.toId)) { fail(`run ${t}: someone pays themselves`); bad++; continue; }
    if (r.transfers.length > Math.max(0, nPeople - 1)) { fail(`run ${t}: ${r.transfers.length} transfers for ${nPeople} people`); bad++; continue; }
    if (!r.checks.every((c) => c.ok)) { fail(`run ${t}: an internal check failed`); bad++; continue; }

    const after = { ...r.net };
    for (const x of r.transfers) {
      after[x.fromId] += x.amount;
      after[x.toId] -= x.amount;
    }
    if (people.some((p) => after[p.id] !== 0)) { fail(`run ${t}: someone was not zeroed by the transfers`); bad++; continue; }

    maxTransfers = Math.max(maxTransfers, r.transfers.length);
  }

  bad
    ? fail(`${bad} party violations`)
    : ok(`${runs} random parties, weights and personal amounts mixed in: shares == spent, balances cancel, <= n-1 transfers (max ${maxTransfers}), everyone ends on zero`);
}

section('computeSplit — edge cases a real user can reach');
{
  const P = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
  const base = { title: 't', currencyCode: 'THB' };
  const item = (over) => ({ id: 'a', name: 'x', amount: 400, payerId: 'p0', bearerIds: ['p0'], weights: {}, ...over });

  const empty = computeSplit({ ...base, people: [], items: [] });
  empty.total === 0 && empty.transfers.length === 0 && empty.balanced
    ? ok('empty party: balanced, nothing to settle')
    : fail('empty party misbehaves');

  const solo = computeSplit({ ...base, people: P(1), items: [item({ amount: 500 })] });
  solo.net.p0 === 0 && solo.transfers.length === 0
    ? ok('one person buying for themselves: owes nothing')
    : fail('single-person party misbehaves');

  const noPayer = computeSplit({ ...base, people: P(2), items: [item({ payerId: null, bearerIds: ['p0', 'p1'] })] });
  !noPayer.balanced && noPayer.problems.length > 0
    ? ok('expense with no payer (payer was deleted): flagged, never silently wrong')
    : fail('missing payer was not surfaced');

  const noBearer = computeSplit({ ...base, people: P(2), items: [item({ bearerIds: [] })] });
  !noBearer.balanced && noBearer.problems.length > 0
    ? ok('expense nobody shares: flagged')
    : fail('orphan expense was not surfaced');

  const dupe = computeSplit({ ...base, people: P(2), items: [item({ bearerIds: ['p1', 'p1'] })] });
  dupe.owed.p1 === 400 && dupe.net.p0 === 400 && dupe.balanced
    ? ok('the same person listed twice: charged once')
    : fail(`duplicate bearer double-counts: owed.p1=${dupe.owed.p1}`);

  const ghost = computeSplit({ ...base, people: P(2), items: [item({ bearerIds: ['p1', 'nobody'] })] });
  ghost.owed.p1 === 400 && ghost.balanced
    ? ok('unknown person id in a link: ignored, the rest still balances')
    : fail(`unknown bearer breaks the split: owed.p1=${ghost.owed.p1}`);

  const thirds = computeSplit({ ...base, people: P(3), items: [item({ amount: 10, bearerIds: ['p0', 'p1', 'p2'] })] });
  const shares = [thirds.owed.p0, thirds.owed.p1, thirds.owed.p2];
  shares.reduce((a, b) => a + b, 0) === 10 && Math.max(...shares) - Math.min(...shares) === 1
    ? ok('10 ÷ 3: one person carries the spare unit, the total is still exactly 10')
    : fail(`10/3 broke: ${JSON.stringify(shares)}`);

  const treat = computeSplit({
    ...base,
    people: P(3),
    items: [item({ amount: 66000, payerId: 'p0', bearerIds: ['p1'] })],
  });
  treat.owed.p1 === 66000 && treat.net.p0 === 66000 && treat.net.p1 === -66000 && treat.net.p2 === 0
    ? ok('one person treats: payer is reimbursed in full, bystander untouched')
    : fail('treat case misbehaves');
}


section('one expense — what a person had to themselves, before shares');
{
  const terms = (list) => list.map(([weight, extra]) => ({ weight, extra }));

  // 1. the case this was asked for: karaoke 300, four sharing, A ate 20 of snacks
  const kara = shareOut(30000, terms([[1, 2000], [1, 0], [1, 0], [1, 0]]));
  kara.parts.join(',') === '9000,7000,7000,7000' && kara.rest === 28000 && kara.extraTotal === 2000
    ? ok('karaoke 300 with A’s own 20: A pays 90, the other three 70 — 280 was what got divided')
    : fail(`karaoke case produced ${JSON.stringify(kara)}`);

  // 2. a multiplier and a personal amount at the same time
  const both = shareOut(30000, terms([[2, 2000], [1, 0], [1, 0]]));
  both.parts.join(',') === '16000,7000,7000' && both.parts.reduce((a, b) => a + b, 0) === 30000
    ? ok('A with ×2 and 20 of their own: 20 first, then twice the share of the remaining 280')
    : fail(`weights plus personal amounts produced ${JSON.stringify(both)}`);

  // 3. a remainder that will not divide cleanly still lands on the exact bill
  const odd = shareOut(10000, terms([[1, 100], [1, 0], [1, 0], [1, 0]]));
  const shared = odd.shared;
  odd.parts.reduce((a, b) => a + b, 0) === 10000 &&
  Math.max(...shared) - Math.min(...shared) <= 1
    ? ok('99 split four ways after a personal 1: the parts still add back to exactly 100')
    : fail(`uneven remainder produced ${JSON.stringify(odd)}`);

  // 4. the invariant, over every combination worth trying
  let bad = 0;
  let cases = 0;
  for (let amount = 0; amount <= 3000; amount += 37) {
    for (let own = 0; own <= 3500; own += 53) {
      for (let n = 1; n <= 5; n++) {
        const list = Array.from({ length: n }, (_, i) => ({ weight: (i % 3) + 1, extra: i === 0 ? own : 0 }));
        const out = shareOut(amount, list);
        cases++;
        if (out.parts.reduce((a, b) => a + b, 0) !== amount) bad++;
        if (out.extraTotal !== own) bad++;
        if (out.rest !== amount - own) bad++;
      }
    }
  }
  bad
    ? fail(`${bad} personal-amount violations`)
    : ok(`${cases.toLocaleString('en-US')} divisions with a personal amount: the parts add up to the expense, exactly, every time`);

  // 5. junk cannot make money appear
  const junk = shareOut(30000, [
    { weight: NaN, extra: NaN },
    { weight: -4, extra: -500 },
    { weight: Infinity, extra: Infinity },
    { weight: 1, extra: '20' },
  ]);
  junk.parts.reduce((a, b) => a + b, 0) === 30000 && junk.extraTotal === 0
    ? ok('nonsense weights and personal amounts read as one share and nothing of their own')
    : fail(`junk terms produced ${JSON.stringify(junk)}`);

  // 6. more set aside than the expense: wrong, but still exact
  const over = shareOut(30000, terms([[1, 20000], [1, 20000]]));
  over.parts.reduce((a, b) => a + b, 0) === 30000 && over.rest === -10000
    ? ok('personal amounts over the expense stay exact — the shortfall is shared as a credit')
    : fail(`overshoot produced ${JSON.stringify(over)}`);

  // 7. with nobody carrying anything alone, nothing changes at all
  let same = true;
  for (let amount = 0; amount <= 500; amount++) {
    const plain = allocate(amount, [1, 2, 3]);
    const viaTerms = shareOut(amount, terms([[1, 0], [2, 0], [3, 0]])).parts;
    if (plain.join(',') !== viaTerms.join(',')) same = false;
  }
  same
    ? ok('an expense with no personal amounts divides exactly as it always did')
    : fail('adding the feature changed an ordinary split');
}

section('personal amounts — through the whole engine');
{
  const people = [
    { id: 'p_a', name: 'A' },
    { id: 'p_b', name: 'B' },
    { id: 'p_c', name: 'C' },
    { id: 'p_d', name: 'D' },
  ];
  const all = people.map((p) => p.id);
  const party = (over) => ({
    title: 'karaoke',
    currencyCode: 'THB',
    people,
    items: [{
      id: 'i1', name: 'Karaoke room', amount: 30000, payerId: 'p_b',
      bearerIds: all, weights: {}, extras: { p_a: 2000 }, ...over,
    }],
  });

  const r = computeSplit(party());
  r.owed.p_a === 9000 && r.owed.p_b === 7000 && r.owed.p_c === 7000 && r.owed.p_d === 7000
    ? ok('B paid the 300: A owes 90 and everyone else 70')
    : fail(`shares came out ${JSON.stringify(r.owed)}`);

  r.net.p_b === 23000 && r.transfers.every((t) => t.toId === 'p_b') &&
  r.transfers.reduce((a, t) => a + t.amount, 0) === 23000
    ? ok('B gets back exactly the 230 they are out of pocket')
    : fail(`settlement came out ${JSON.stringify(r.transfers)}`);

  r.checks.every((c) => c.ok) && r.balanced
    ? ok('every automatic check passes with a personal amount in play')
    : fail('a check failed on an expense with a personal amount');

  const b = r.breakdowns[0];
  b.extraTotal === 2000 && b.rest === 28000 && b.extras.p_a === 2000 && !b.even
    ? ok('the proof can say what came off the top and what was left to divide')
    : fail(`breakdown came out ${JSON.stringify({ e: b.extraTotal, r: b.rest, even: b.even })}`);

  // an amount left behind for somebody who is no longer sharing it
  const stale = computeSplit(party({ bearerIds: ['p_b', 'p_c'], extras: { p_a: 2000 } }));
  stale.owed.p_a === 0 && stale.owed.p_b === 15000 && stale.owed.p_c === 15000
    ? ok('an amount left over for someone since taken off the expense is ignored, not charged')
    : fail(`stale personal amount produced ${JSON.stringify(stale.owed)}`);

  // the same person named twice must not be charged their own amount twice
  const dupe = computeSplit(party({ bearerIds: ['p_a', 'p_a', 'p_b'], extras: { p_a: 2000 } }));
  dupe.owed.p_a === 16000 && dupe.owed.p_b === 14000 &&
  dupe.owed.p_a + dupe.owed.p_b === 30000
    ? ok('a repeated bearer is collapsed first, so their own amount is counted once')
    : fail(`duplicate bearer produced ${JSON.stringify(dupe.owed)}`);

  // setting aside more than the expense is flagged, and still adds up
  const over = computeSplit(party({ extras: { p_a: 20000, p_b: 20000 } }));
  const sumOwed = all.reduce((a, id) => a + (over.owed[id] ?? 0), 0);
  sumOwed === 30000 && over.problems.some((m) => m.includes('more than the expense'))
    ? ok('setting aside more than the expense is called out, and the total still ties to the bill')
    : fail(`overshoot produced ${sumOwed} with problems ${JSON.stringify(over.problems)}`);
}

section('money — parsing, display, currency changes');
{
  let bad = 0;
  const parses = [
    ['1600', 2, 160000], ['1,600.50', 2, 160050], ['  400 ', 2, 40000],
    ['0.05', 2, 5], ['1600', 0, 1600], ['12.345', 2, 1235],
    ['', 2, null], ['abc', 2, null], ['.', 2, null],
  ];
  for (const [txt, dec, want] of parses) {
    const got = parseAmount(txt, dec);
    if (got !== want) { fail(`parseAmount(${JSON.stringify(txt)}, ${dec}) = ${got}, want ${want}`); bad++; }
  }

  const displays = [
    [160000, 'THB', '฿1,600'], [160050, 'THB', '฿1,600.50'], [0, 'THB', '฿0'],
    [-124000, 'THB', '−฿1,240'], [1600, 'JPY', '¥1,600'],
  ];
  for (const [minor, code, want] of displays) {
    const got = formatMoney(minor, code);
    if (got !== want) { fail(`formatMoney(${minor}, ${code}) = ${got}, want ${want}`); bad++; }
  }

  // ฿400 must stay 400 when the currency switches, not become ¥40,000.
  if (rescaleAmount(40000, 2, 0) !== 400) { fail('THB -> JPY did not rescale'); bad++; }
  if (rescaleAmount(400, 0, 2) !== 40000) { fail('JPY -> THB did not rescale'); bad++; }
  if (rescaleAmount(40000, 2, 2) !== 40000) { fail('same-precision switch changed the amount'); bad++; }

  if (!bad) ok('17 parse / format / currency-switch cases');
}

section('share links — round trip');
{
  const original = referenceParty();
  const incoming = decodeParty(encodeParty(original, 'Somchai'));
  const restored = incoming && incoming.party;

  if (!restored) {
    fail('a share link did not decode');
  } else {
    const a = computeSplit(original);
    const b = computeSplit(restored);
    const shape = (s, r) => ({
      title: s.title,
      currency: s.currencyCode,
      names: s.people.map((p) => p.name),
      total: r.total,
      owed: s.people.map((p) => r.owed[p.id]),
      transfers: r.transfers.map((t) => [
        s.people.find((p) => p.id === t.fromId).name,
        s.people.find((p) => p.id === t.toId).name,
        t.amount,
      ]),
    });
    JSON.stringify(shape(original, a)) === JSON.stringify(shape(restored, b))
      ? ok('a party survives encode -> link -> decode with identical results')
      : fail('share link round trip changed the numbers');

    restored.date === original.date
      ? ok('the party date travels with the link')
      : fail(`date lost in transit: ${restored.date} vs ${original.date}`);

    incoming.sharedBy === 'Somchai'
      ? ok('the link says who shared it')
      : fail(`sharedBy lost: ${incoming.sharedBy}`);
  }

  decodeParty('not-a-real-link') === null
    ? ok('a corrupt link is rejected rather than half-loaded')
    : fail('corrupt link was accepted');

  // Links made before profiles and dates existed must still open.
  const legacy = decodeParty(
    Buffer.from(JSON.stringify({
      t: 'Old party', c: 'THB', p: ['A', 'B'],
      i: [['Beer', 20000, 0, [0, 1], [1, 1]]],
    })).toString('base64url'),
  );
  legacy && legacy.party.people.length === 2 && legacy.party.items[0].amount === 20000 && legacy.sharedBy === null
    ? ok('a link from the previous version still opens')
    : fail('backwards compatibility broken');

  // Personal amounts have to survive the trip, or a link would quietly re-split
  // an expense somebody had already settled the shape of.
  {
    const plain = referenceParty();
    const withOwn = referenceParty();
    // M had 20 of the karaoke room to themselves.
    withOwn.items[3] = { ...withOwn.items[3], extras: { p_m: 2000 } };

    const back = decodeParty(encodeParty(withOwn));
    const before = computeSplit(withOwn);
    const after = back && computeSplit(back.party);

    after && withOwn.people.every((p, i) => before.owed[p.id] === after.owed[back.party.people[i].id])
      ? ok('an amount somebody had to themselves survives the link intact')
      : fail('a personal amount was lost or changed in a share link');

    after && after.owed[back.party.people[1].id] !== computeSplit(plain).owed[plain.people[1].id]
      ? ok('and it is actually doing something — the shares differ from the same party without it')
      : fail('the personal amount made no difference, so the test proves nothing');

    // An ordinary split must not pay for the feature in link length.
    const rows = JSON.parse(Buffer.from(encodeParty(plain), 'base64url').toString()).i;
    rows.every((row) => row.length === 5)
      ? ok('a link only carries personal amounts when there are some to carry')
      : fail(`an ordinary party packed ${JSON.stringify(rows.map((r) => r.length))}`);
  }
}

section('history and presets');
{
  const store = emptyStore();
  const pid = store.activeProfileId;

  // an empty sheet is not worth filing
  const untouched = archiveCurrent(store, pid);
  untouched.history[pid].length === 0
    ? ok('starting fresh on a blank sheet files nothing away')
    : fail('an empty party was archived');

  // once money is on it, it gets kept
  const withParty = updateCurrent(store, pid, () => ({ ...referenceParty(), id: 'night_one', title: 'Night one' }));
  const archivedStore = archiveCurrent(withParty, pid);
  const kept = archivedStore.history[pid][0];

  kept && kept.title === 'Night one' && archivedStore.current[pid].items.length === 0
    ? ok('saving hands back a blank sheet and keeps the old party')
    : fail('archiveCurrent did not swap the party out');

  // reopening takes it back out rather than duplicating it
  const second = updateCurrent(archivedStore, pid, () => ({ ...referenceParty(), id: 'night_two', title: 'Night two' }));
  const reopened = reopenFromHistory(second, pid, kept.id);

  reopened.current[pid].title === 'Night one' &&
  reopened.history[pid].length === 1 &&
  reopened.history[pid][0].title === 'Night two'
    ? ok('reopening swaps the two parties instead of cloning either')
    : fail(`reopen went wrong: current=${reopened.current[pid].title}, history=${reopened.history[pid].map((p) => p.title)}`);

  deleteFromHistory(reopened, pid, reopened.history[pid][0].id).history[pid].length === 0
    ? ok('deleting from history removes exactly one entry')
    : fail('delete from history misbehaved');

  // presets: the crew and the usual names, never the amounts
  const source = referenceParty();
  const preset = presetFromParty(source, 'Bros');
  const names = JSON.stringify(preset.people);

  names === JSON.stringify(['Q', 'M', 'F', 'B', 'Y']) && preset.itemNames.length === source.items.length
    ? ok('a preset captures the crew and the usual expense names')
    : fail(`preset capture wrong: ${names}`);

  JSON.stringify(preset).includes('amount')
    ? fail('a preset stored an amount')
    : ok('a preset carries no amounts');

  const blank = newParty('THB');
  const once = applyPreset(blank, preset);
  const twice = applyPreset(once, preset);

  once.people.length === 5 && twice.people.length === 5
    ? ok('applying a preset twice does not double anybody up')
    : fail(`preset apply duplicated people: ${once.people.length} then ${twice.people.length}`);

  const partial = applyPreset({ ...newParty('THB'), people: [{ id: 'x', name: 'q' }] }, preset);
  partial.people.length === 5
    ? ok('a name already present is matched case-insensitively, not added twice')
    : fail(`case-insensitive merge failed: ${partial.people.map((p) => p.name)}`);
}

section('the party this was built for');
{
  const st = referenceParty();
  const r = computeSplit(st);
  const nm = (id) => st.people.find((p) => p.id === id).name;
  const as = (rec) => Object.fromEntries(st.people.map((p) => [p.name, rec[p.id] / 100]));

  const want = {
    owed: { Q: 780, M: 1240, F: 780, B: 580, Y: 180 },
    paid: { Q: 3390, M: 0, F: 0, B: 0, Y: 170 },
    net: { Q: 2610, M: -1240, F: -780, B: -580, Y: -10 },
    transfers: ['M->Q 1240', 'F->Q 780', 'B->Q 580', 'Y->Q 10'],
  };
  const got = {
    owed: as(r.owed),
    paid: as(r.paid),
    net: as(r.net),
    transfers: r.transfers.map((t) => `${nm(t.fromId)}->${nm(t.toId)} ${t.amount / 100}`),
  };

  JSON.stringify(got) === JSON.stringify(want)
    ? ok('matches the hand-worked proof exactly')
    : fail(`\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`);
}

section('what the screen actually shows');
{
  // The components format straight off computeSplit, so pinning the rendered strings
  // for the reference party catches a display change quietly corrupting the numbers.
  const st = referenceParty();
  const r = computeSplit(st);
  const money = (v) => formatMoney(v, st.currencyCode);
  const nameOf = (id) => st.people.find((p) => p.id === id).name;

  const balanceCards = st.people.map((p) => {
    const net = r.net[p.id];
    const tag = net > 0 ? 'gets back' : net < 0 ? 'owes' : 'settled';
    const signed = net === 0 ? money(0) : formatMoney(net, st.currencyCode, { sign: true });
    return `${p.name} | ${signed} ${tag} | Share ${money(r.owed[p.id])} | Paid ${money(r.paid[p.id])}`;
  });

  const expectedCards = [
    'Q | +฿2,610 gets back | Share ฿780 | Paid ฿3,390',
    'M | −฿1,240 owes | Share ฿1,240 | Paid ฿0',
    'F | −฿780 owes | Share ฿780 | Paid ฿0',
    'B | −฿580 owes | Share ฿580 | Paid ฿0',
    'Y | −฿10 owes | Share ฿180 | Paid ฿170',
  ];

  JSON.stringify(balanceCards) === JSON.stringify(expectedCards)
    ? ok('every balance card reads exactly as it should')
    : fail(`balance cards drifted: ${balanceCards.join('  //  ')}`);

  // Proof step 3: both totals must print as the same string, and the balance as zero.
  const totalShare = money(r.totalOwed);
  const totalPaid = money(r.total);
  totalShare === totalPaid && totalShare === '฿3,560' && money(0) === '฿0'
    ? ok('the proof total row prints share = spent = 3,560 and balance 0')
    : fail(`proof totals print wrong: share ${totalShare}, paid ${totalPaid}`);

  // Proof step 2: every column of the matrix must add back to its own bill.
  const columnsAddUp = r.breakdowns.every((b) => {
    const column = st.people.reduce((a, p) => a + (b.perPerson[p.id] ?? 0), 0);
    return column === b.item.amount;
  });
  columnsAddUp
    ? ok('every column of the proof matrix adds back to its expense')
    : fail('a proof matrix column does not add up to its expense');

  const settlement = r.transfers.map((t) => `${nameOf(t.fromId)} to ${nameOf(t.toId)} ${money(t.amount)}`);
  JSON.stringify(settlement) === JSON.stringify([
    'M to Q ฿1,240', 'F to Q ฿780', 'B to Q ฿580', 'Y to Q ฿10',
  ])
    ? ok('the chat summary lists the right payments in the right order')
    : fail(`settlement text drifted: ${settlement.join(' / ')}`);
}

section('PromptPay QR payloads');
{
  // The published check value for CRC-16/CCITT-FALSE. If this drifts, every QR is wrong.
  crc16('123456789') === '29B1'
    ? ok('CRC-16/CCITT-FALSE matches its published check value (29B1)')
    : fail(`crc16("123456789") = ${crc16('123456789')}, expected 29B1`);

  const ids = [
    ['0812345678', 'mobile', '0066812345678'],
    ['081-234-5678', 'mobile', '0066812345678'],
    ['812345678', 'mobile', '0066812345678'],
    ['1234567890123', 'nationalId', '1234567890123'],
    ['004000000001234', 'ewallet', '004000000001234'],
  ];
  let badIds = 0;
  for (const [raw, kind, value] of ids) {
    const got = parsePromptPayId(raw);
    if (!got || got.kind !== kind || got.value !== value) {
      fail(`parsePromptPayId(${JSON.stringify(raw)}) = ${JSON.stringify(got)}`);
      badIds++;
    }
  }
  [' ', '12345', 'abcdefghij'].forEach((raw) => {
    if (parsePromptPayId(raw) !== null) { fail(`${JSON.stringify(raw)} should not parse`); badIds++; }
  });
  if (!badIds) ok('8 id forms: phone, ID and e-wallet recognised, junk rejected');

  const noAmount = buildPromptPayPayload('0812345678');
  const withAmount = buildPromptPayPayload('0812345678', 124000);

  noAmount === '00020101021129370016A0000006770101110113006681234567853037645802TH6304823E'
    ? ok('a reusable code is byte-for-byte what it should be')
    : fail(`static payload drifted: ${noAmount}`);

  withAmount === '00020101021229370016A00000067701011101130066812345678530376454071240.005802TH63040BB6'
    ? ok('a one-time code for 1,240 is byte-for-byte what it should be')
    : fail(`dynamic payload drifted: ${withAmount}`);

  const tags = parseTlv(withAmount);
  const merchant = parseTlv(tags['29'] ?? '');
  tags['01'] === '12' && tags['53'] === '764' && tags['58'] === 'TH' && tags['54'] === '1240.00' &&
  merchant['00'] === 'A000000677010111' && merchant['01'] === '0066812345678'
    ? ok('it says: one-time, Thai baht, Thailand, 1240.00, to that PromptPay number')
    : fail(`payload fields wrong: ${JSON.stringify(tags)}`);

  parseTlv(noAmount)['01'] === '11' && parseTlv(noAmount)['54'] === undefined
    ? ok('a code with no amount is marked reusable and carries no amount tag')
    : fail('static payload is not marked reusable');

  verifyPromptPayPayload(withAmount) && verifyPromptPayPayload(noAmount)
    ? ok('both payloads pass their own CRC check')
    : fail('a generated payload fails its own CRC');

  verifyPromptPayPayload(withAmount.slice(0, -6) + 'X' + withAmount.slice(-5))
    ? fail('a tampered payload still passed the CRC check')
    : ok('a tampered payload fails the CRC, so a bank app would reject it');

  // A different amount must be a different code — otherwise someone pays the wrong sum.
  buildPromptPayPayload('0812345678', 78000) !== withAmount
    ? ok('changing the amount changes the code')
    : fail('two different amounts produced the same QR');

  buildPromptPayPayload('12345') === null
    ? ok('an unusable number yields no QR rather than a broken one')
    : fail('a junk number produced a payload');
}

section('payment details and photo bookkeeping');
{
  const store = emptyStore();
  const pid = store.activeProfileId;

  const withNumber = setPayee(store, pid, 'Q', { promptPayId: '0812345678' });
  const found = payeeFor(withNumber, pid, 'q');
  found && found.promptPayId === '0812345678' && hasPaymentDetails(found)
    ? ok('payment details are found whatever the case of the name')
    : fail('payee lookup is case sensitive');

  payeeFor(withNumber, pid, 'Nobody') === null
    ? ok('someone with no details set returns nothing')
    : fail('payee lookup invented an entry');

  const cleared = setPayee(withNumber, pid, 'Q', { promptPayId: null });
  payeeFor(cleared, pid, 'Q') === null
    ? ok('clearing the last detail removes the entry entirely')
    : fail('an empty payee entry was left behind');

  const both = setPayee(setPayee(store, pid, 'Q', { promptPayId: '0812345678' }), pid, 'Q', { qrPhotoId: 'qr_1' });
  const merged = payeeFor(both, pid, 'Q');
  merged.promptPayId === '0812345678' && merged.qrPhotoId === 'qr_1'
    ? ok('adding a QR image keeps the number that was already there')
    : fail('setting one payment field wiped the other');

  // Every referenced blob must be kept; anything else is swept from IndexedDB.
  const photo = { id: 'ph_1', expenseId: null, w: 10, h: 10, bytes: 100, addedAt: 0 };
  const withPhotos = updateCurrent(both, pid, (party) => addPhotoMeta(party, photo));
  const refs = referencedPhotoIds(withPhotos);
  refs.has('ph_1') && refs.has('qr_1') && refs.size === 2
    ? ok('party photos and payment QRs both count as still in use')
    : fail(`referenced ids wrong: ${[...refs].join(', ')}`);

  const dropped = updateCurrent(withPhotos, pid, (party) => ({ ...party, photos: [] }));
  referencedPhotoIds(dropped).has('ph_1')
    ? fail('a removed photo is still considered in use')
    : ok('a removed photo stops being referenced, so its blob can be swept');
}

section('cloud sync — turning edits into row writes');
{
  const base = referenceParty();
  const slice = (party, history = []) => ({ current: party, history, presets: [], payees: {} });
  const tables = (ops) => ops.map((o) => `${o.table}:${o.op}`);

  diffParty(base, base).length === 0
    ? ok('an untouched party produces no writes at all')
    : fail(`idle diff emitted ${diffParty(base, base).length} ops`);

  // renaming one expense must not disturb its shares or anybody else's rows
  const renamed = { ...base, items: base.items.map((i) => (i.id === 'i_pork' ? { ...i, name: 'Pork belly' } : i)) };
  const renameOps = diffParty(base, renamed);
  renameOps.length === 1 && renameOps[0].table === 'expenses' && renameOps[0].id === 'i_pork'
    ? ok('renaming one expense writes exactly one row')
    : fail(`rename emitted ${JSON.stringify(tables(renameOps))}`);

  // changing who shares touches the share rows, not the expense row
  const reshared = {
    ...base,
    items: base.items.map((i) => (i.id === 'i_pork' ? { ...i, bearerIds: ['p_q', 'p_f', 'p_b'] } : i)),
  };
  const shareOps = diffParty(base, reshared);
  shareOps.length === 1 && shareOps[0].table === 'expense_shares' && shareOps[0].shares.length === 3
    ? ok('changing who shares rewrites only the share rows')
    : fail(`reshare emitted ${JSON.stringify(tables(shareOps))}`);

  // THE claim: two people editing different expenses must not touch the same rows
  const mEdits = { ...base, items: base.items.map((i) => (i.id === 'i_booze' ? { ...i, amount: 70000 } : i)) };
  const fEdits = { ...base, items: base.items.map((i) => (i.id === 'i_pork' ? { ...i, amount: 45000 } : i)) };
  const mRows = new Set(diffParty(base, mEdits).map((o) => `${o.table}:${o.id ?? o.expenseId ?? o.key}`));
  const fRows = new Set(diffParty(base, fEdits).map((o) => `${o.table}:${o.id ?? o.expenseId ?? o.key}`));
  const overlap = [...mRows].filter((r) => fRows.has(r));

  mRows.size > 0 && fRows.size > 0 && overlap.length === 0
    ? ok('two people editing different expenses write to disjoint rows — no silent overwrite')
    : fail(`edits collided on ${overlap.join(', ')}`);


  // A changed personal amount is a change like any other: it must travel, and it
  // must not drag the whole expense along with it.
  {
    const withOwn = {
      ...base,
      items: base.items.map((it) =>
        it.id === 'i_kara1' ? { ...it, extras: { p_m: 2000 } } : it,
      ),
    };

    const ops = diffParty(base, withOwn);
    const shareOps = ops.filter((o) => o.table === 'expense_shares');
    ops.every((o) => o.table === 'expense_shares') && shareOps.length === 1 &&
    shareOps[0].expenseId === 'i_kara1' &&
    shareOps[0].shares.find((sh) => sh.personId === 'p_m').extra === 2000
      ? ok('setting an amount for one person rewrites that expense’s shares and nothing else')
      : fail(`personal amount emitted ${JSON.stringify(tables(ops))}`);

    diffParty(withOwn, withOwn).length === 0
      ? ok('an unchanged personal amount is not resent')
      : fail('an unchanged personal amount was resent');

    const cleared = diffParty(withOwn, base).filter((o) => o.table === 'expense_shares');
    cleared.length === 1 && cleared[0].shares.every((sh) => sh.extra === 0)
      ? ok('clearing it writes the shares back with nothing set aside')
      : fail(`clearing emitted ${JSON.stringify(cleared)}`);
  }

  // adding a person, and removing one
  const added = { ...base, people: [...base.people, { id: 'p_new', name: 'Z' }] };
  const addOps = diffParty(base, added);
  addOps.length === 1 && addOps[0].table === 'party_people' && addOps[0].name === 'Z'
    ? ok('adding a member writes one row')
    : fail(`add member emitted ${JSON.stringify(tables(addOps))}`);

  const removed = { ...base, people: base.people.filter((p) => p.id !== 'p_y') };
  const removeOps = diffParty(base, removed);
  removeOps.some((o) => o.table === 'party_people' && o.op === 'delete' && o.id === 'p_y')
    ? ok('removing a member deletes their row')
    : fail('removing a member did not delete the row');

  // moving a party to history is a flag flip, not a delete and re-insert
  const archiveOps = diffGroup(slice(base), slice(null, [base]));
  archiveOps.filter((o) => o.table === 'parties').every((o) => o.op === 'upsert') &&
  archiveOps.some((o) => o.table === 'parties' && o.op === 'upsert' && o.id === base.id)
    ? ok('archiving a party updates it in place rather than deleting it')
    : fail(`archive emitted ${JSON.stringify(tables(archiveOps))}`);

  // deleting a party for real does delete it
  const deleteOps = diffGroup(slice(base), slice(null, []));
  deleteOps.length === 1 && deleteOps[0].table === 'parties' && deleteOps[0].op === 'delete'
    ? ok('deleting a party emits a single delete')
    : fail(`delete emitted ${JSON.stringify(tables(deleteOps))}`);

  // a brand new party sends everything it needs in one go
  const fresh = diffParty(null, base);
  const kinds = new Set(fresh.map((o) => o.table));
  kinds.has('parties') && kinds.has('party_people') && kinds.has('expenses') && kinds.has('expense_shares') &&
  fresh.filter((o) => o.table === 'party_people').length === base.people.length &&
  fresh.filter((o) => o.table === 'expenses').length === base.items.length
    ? ok('a new party uploads its people and expenses completely')
    : fail(`new party emitted ${JSON.stringify(tables(fresh))}`);
}


section('repayments — a record, never an input');
{
  // 1. the key names a direction, not just a pair
  repaymentKey('a', 'b') !== repaymentKey('b', 'a') && repaymentKey('a', 'b') === 'a>b'
    ? ok('a repayment is addressed to one direction: “a>b” is not “b>a”')
    : fail('repaymentKey is ambiguous about direction');

  // 2. the arithmetic of "how much is left", over every combination worth having
  let bad = 0;
  let readings = 0;
  for (let amount = 0; amount <= 400; amount += 7) {
    for (let paid = -50; paid <= 500; paid += 3) {
      const v = repaymentView(amount, paid);
      readings++;
      if (v.paid < 0 || v.left < 0) bad++;
      if (v.paid + v.left !== amount) bad++;
      if (v.paid > amount) bad++;
      if (v.done !== (amount > 0 && v.left === 0)) bad++;
    }
  }
  bad
    ? fail(`${bad} repayment-view violations`)
    : ok(`${readings.toLocaleString('en-US')} repayment readings: paid + left is the payment exactly, and neither goes negative`);

  // 3. junk from a hand-edited link or an older sheet cannot produce a negative debt
  const junk = [NaN, Infinity, -Infinity, -1, undefined, null, '500'];
  junk.every((v) => {
    const r = repaymentView(124000, v);
    return r.left >= 0 && r.left <= 124000 && r.paid >= 0;
  })
    ? ok('a nonsense repayment reads as zero rather than as money owed back')
    : fail('a junk repayment produced a bad remainder');

  repaymentView(124000, 999999).left === 0 && repaymentView(124000, 999999).paid === 124000
    ? ok('paying back more than the payment leaves nothing outstanding, not a credit')
    : fail('overpayment did not clamp');

  repaymentView(0, 0).done === false
    ? ok('a payment of nothing is not “settled” — there was never anything to settle')
    : fail('an empty payment reported itself as done');

  // 4. the whole point: typing a repayment must not move the split
  const party = referenceParty();
  const before = computeSplit(party);
  const after = computeSplit({
    ...party,
    repayments: { [repaymentKey('p_m', 'p_q')]: 50000, [repaymentKey('p_y', 'p_q')]: 1000 },
  });
  JSON.stringify(before) === JSON.stringify(after)
    ? ok('recording a repayment changes nothing about the split or its proof')
    : fail('a repayment altered the computed split');

  // 5. the reference party, half-settled by hand
  const mToQ = before.transfers.find((t) => t.fromId === 'p_m' && t.toId === 'p_q');
  const yToQ = before.transfers.find((t) => t.fromId === 'p_y' && t.toId === 'p_q');
  const half = repaymentView(mToQ.amount, 50000);
  half.left === 74000 && half.paid === 50000 && half.done === false
    ? ok('M owes Q 1,240 and has handed over 500: 740 left, still open')
    : fail(`half-settled row read ${JSON.stringify(half)}`);

  repaymentView(yToQ.amount, yToQ.amount).done && repaymentView(yToQ.amount, yToQ.amount).left === 0
    ? ok('Y’s 10 marked as paid closes that row exactly')
    : fail('paying a row in full did not close it');
}

section('repayments — what reaches the database');
{
  const base = { ...referenceParty(), repayments: {} };
  const withOne = { ...base, repayments: { 'p_m>p_q': 50000 } };

  const addOps = diffParty(base, withOne).filter((o) => o.table === 'repayments');
  addOps.length === 1 && addOps[0].op === 'upsert' && addOps[0].fromId === 'p_m' &&
  addOps[0].toId === 'p_q' && addOps[0].amountPaid === 50000
    ? ok('recording a repayment writes one row, naming both people and the amount')
    : fail(`recording a repayment emitted ${JSON.stringify(addOps)}`);

  const changed = { ...base, repayments: { 'p_m>p_q': 60000 } };
  const changeOps = diffParty(withOne, changed).filter((o) => o.table === 'repayments');
  changeOps.length === 1 && changeOps[0].op === 'upsert' && changeOps[0].amountPaid === 60000
    ? ok('changing the amount rewrites that one row and nothing else')
    : fail(`changing a repayment emitted ${JSON.stringify(changeOps)}`);

  const clearOps = diffParty(withOne, base).filter((o) => o.table === 'repayments');
  clearOps.length === 1 && clearOps[0].op === 'delete' && clearOps[0].fromId === 'p_m'
    ? ok('clearing a repayment deletes the row rather than storing a zero')
    : fail(`clearing a repayment emitted ${JSON.stringify(clearOps)}`);

  diffParty(withOne, withOne).filter((o) => o.table === 'repayments').length === 0
    ? ok('an unchanged repayment is not resent')
    : fail('an unchanged repayment was resent');

  // Two people, two different rows, no collision — the same guarantee as expenses.
  const mine = { ...base, repayments: { 'p_m>p_q': 50000 } };
  const theirs = { ...base, repayments: { 'p_f>p_q': 30000 } };
  const keys = (ops) => ops.filter((o) => o.table === 'repayments').map((o) => `${o.fromId}>${o.toId}`);
  const theirKeys = keys(diffParty(base, theirs));
  const overlap = keys(diffParty(base, mine)).filter((k) => theirKeys.includes(k));
  overlap.length === 0
    ? ok('two people recording different repayments write to different rows')
    : fail(`repayments collided on ${overlap.join(', ')}`);

  // A repayment left over from someone since taken off the split must not be sent:
  // the row it points at cannot exist, and the person delete travels in this batch.
  const orphaned = {
    ...base,
    people: base.people.filter((p) => p.id !== 'p_y'),
    repayments: { 'p_y>p_q': 1000, 'p_m>p_q': 50000 },
  };
  const orphanOps = diffParty(base, orphaned).filter((o) => o.table === 'repayments');
  orphanOps.length === 1 && orphanOps[0].fromId === 'p_m'
    ? ok('a repayment naming someone no longer on the split is not written')
    : fail(`orphan repayment emitted ${JSON.stringify(orphanOps)}`);
}

console.log(fails === 0 ? '\nALL GREEN\n' : `\n${fails} FAILURE(S)\n`);
process.exit(fails ? 1 : 0);
