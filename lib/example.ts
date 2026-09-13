import type { EventState } from './types';

/** The party this app was built for — handy as a live demo of every feature. */
export function exampleState(): EventState {
  const p = { q: 'p_q', m: 'p_m', f: 'p_f', b: 'p_b', y: 'p_y' };
  const all = [p.q, p.m, p.f, p.b, p.y];
  const eaters = [p.q, p.m, p.f, p.b];

  return {
    title: 'House Party',
    currencyCode: 'THB',
    people: [
      { id: p.q, name: 'Q' },
      { id: p.m, name: 'M' },
      { id: p.f, name: 'F' },
      { id: p.b, name: 'B' },
      { id: p.y, name: 'Y' },
    ],
    items: [
      { id: 'i_pork', name: 'Pork', amount: 40000, payerId: p.q, bearerIds: [p.q, p.f], weights: {} },
      { id: 'i_makro', name: 'Makro groceries', amount: 160000, payerId: p.q, bearerIds: eaters, weights: {} },
      { id: 'i_booze', name: 'Alcohol (M’s treat)', amount: 66000, payerId: p.q, bearerIds: [p.m], weights: {} },
      { id: 'i_kara1', name: 'Karaoke room', amount: 41000, payerId: p.q, bearerIds: all, weights: {} },
      { id: 'i_kara2', name: 'Karaoke extra hour', amount: 32000, payerId: p.q, bearerIds: all, weights: {} },
      { id: 'i_711', name: '7-Eleven run', amount: 17000, payerId: p.y, bearerIds: all, weights: {} },
    ],
  };
}

export function blankState(): EventState {
  return {
    title: 'New Party',
    currencyCode: 'THB',
    people: [],
    items: [],
  };
}
