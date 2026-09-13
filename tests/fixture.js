/**
 * The reference party — the real one this app was built to settle.
 *
 * It lives here rather than in the app because the app ships no sample data:
 * everyone starts with an empty sheet. The suite still needs a party whose answer
 * was worked out by hand, so it can prove the engine reproduces it exactly.
 *
 *   pork 400          split by Q and F only
 *   makro 1,600       split by Q, M, F, B (Y eats nothing)
 *   alcohol 660       paid by Q but carried entirely by M, who was treating
 *   karaoke 410+320   split by all five
 *   7-Eleven 170      paid by Y, split by all five
 *
 * Worked out by hand, the shares are Q 780, M 1,240, F 780, B 580, Y 180 against
 * a 3,560 bill, settled by M→Q 1,240, F→Q 780, B→Q 580 and Y→Q 10.
 */
function referenceParty() {
  const p = { q: 'p_q', m: 'p_m', f: 'p_f', b: 'p_b', y: 'p_y' };
  const all = [p.q, p.m, p.f, p.b, p.y];
  const eaters = [p.q, p.m, p.f, p.b];
  const now = 1_700_000_000_000;

  const item = (id, name, amount, payerId, bearerIds) => ({
    id,
    name,
    amount,
    payerId,
    bearerIds,
    weights: {},
  });

  return {
    id: 'party_reference',
    title: 'House Party',
    date: '2026-09-13',
    currencyCode: 'THB',
    people: [
      { id: p.q, name: 'Q' },
      { id: p.m, name: 'M' },
      { id: p.f, name: 'F' },
      { id: p.b, name: 'B' },
      { id: p.y, name: 'Y' },
    ],
    items: [
      item('i_pork', 'Pork', 40000, p.q, [p.q, p.f]),
      item('i_makro', 'Makro groceries', 160000, p.q, eaters),
      item('i_booze', 'Alcohol (M’s treat)', 66000, p.q, [p.m]),
      item('i_kara1', 'Karaoke room', 41000, p.q, all),
      item('i_kara2', 'Karaoke extra hour', 32000, p.q, all),
      item('i_711', '7-Eleven run', 17000, p.y, all),
    ],
    photos: [],
    repayments: {},
    createdAt: now,
    updatedAt: now,
  };
}

module.exports = { referenceParty };
