/**
 * Correctness suite for the money maths. Run with `npm run verify`.
 *
 * The point of this file is that nobody has to take the split on faith. It checks
 * the invariants that actually matter — shares add up to the bill, balances cancel,
 * settling leaves everyone on zero — across hundreds of thousands of generated
 * parties, plus the edge cases a real user (or a hand-edited share link) can reach.
 */

const { computeSplit, allocate } = require('../.verify/split.js');
const { exampleState } = require('../.verify/example.js');
const { parseAmount, formatMoney, rescaleAmount } = require('../.verify/format.js');
const { encodeParty, decodeParty } = require('../.verify/share.js');
const {
  applyPreset, archiveCurrent, deleteFromHistory, emptyStore, newParty,
  presetFromParty, reopenFromHistory, sampleParty, updateCurrent,
} = require('../.verify/store.js');

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

      items.push({
        id: `i${k}`,
        name: `item${k}`,
        amount: ri(1, 2_000_000),
        payerId: people[ri(0, nPeople - 1)].id,
        bearerIds,
        weights,
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
    : ok(`${runs} random parties: shares == spent, balances cancel, <= n-1 transfers (max ${maxTransfers}), everyone ends on zero`);
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
  const original = sampleParty();
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
  const withParty = updateCurrent(store, pid, () => ({ ...sampleParty(), title: 'Night one' }));
  const archivedStore = archiveCurrent(withParty, pid);
  const kept = archivedStore.history[pid][0];

  kept && kept.title === 'Night one' && archivedStore.current[pid].items.length === 0
    ? ok('saving hands back a blank sheet and keeps the old party')
    : fail('archiveCurrent did not swap the party out');

  // reopening takes it back out rather than duplicating it
  const second = updateCurrent(archivedStore, pid, () => ({ ...sampleParty(), title: 'Night two' }));
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
  const source = sampleParty();
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
  const st = sampleParty();
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
  const st = sampleParty();
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

console.log(fails === 0 ? '\nALL GREEN\n' : `\n${fails} FAILURE(S)\n`);
process.exit(fails ? 1 : 0);
