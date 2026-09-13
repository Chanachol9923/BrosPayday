export type Person = {
  id: string;
  name: string;
};

export type Item = {
  id: string;
  name: string;
  /** Amount in minor units (e.g. satang / cents) so all math stays in integers. */
  amount: number;
  payerId: string | null;
  bearerIds: string[];
  /** personId -> share weight. Missing means 1. Only used when a split is uneven. */
  weights: Record<string, number>;
};

/** The part of a party the split engine cares about. */
export type EventState = {
  title: string;
  currencyCode: string;
  people: Person[];
  items: Item[];
};

/** A party as it is stored: the split plus its identity, day and timestamps. */
export type Party = EventState & {
  id: string;
  /** The day the party happened, as YYYY-MM-DD in local time. */
  date: string;
  createdAt: number;
  updatedAt: number;
};

/** A local profile. No password, no account — just whose history this is. */
export type Profile = {
  id: string;
  name: string;
  createdAt: number;
};

/** A reusable party template: the same crew, the same usual expenses. */
export type Preset = {
  id: string;
  /** What the template is called, e.g. "Bros" or "Office lunch". */
  name: string;
  /** Default party title when the preset is applied. */
  title: string;
  currencyCode: string;
  people: string[];
  /** Expense names to offer as one-tap starters. No amounts. */
  itemNames: string[];
  createdAt: number;
};

export type Store = {
  version: 2;
  profiles: Profile[];
  activeProfileId: string;
  /** profileId -> the party currently on the workbench */
  current: Record<string, Party>;
  /** profileId -> archived parties, newest first */
  history: Record<string, Party[]>;
  /** profileId -> saved templates */
  presets: Record<string, Preset[]>;
};

export type Currency = {
  code: string;
  symbol: string;
  decimals: number;
  label: string;
};

export const CURRENCIES: Currency[] = [
  { code: 'THB', symbol: '฿', decimals: 2, label: 'Thai Baht' },
  { code: 'USD', symbol: '$', decimals: 2, label: 'US Dollar' },
  { code: 'EUR', symbol: '€', decimals: 2, label: 'Euro' },
  { code: 'GBP', symbol: '£', decimals: 2, label: 'British Pound' },
  { code: 'JPY', symbol: '¥', decimals: 0, label: 'Japanese Yen' },
  { code: 'KRW', symbol: '₩', decimals: 0, label: 'Korean Won' },
  { code: 'SGD', symbol: 'S$', decimals: 2, label: 'Singapore Dollar' },
  { code: 'MYR', symbol: 'RM', decimals: 2, label: 'Malaysian Ringgit' },
  { code: 'PHP', symbol: '₱', decimals: 2, label: 'Philippine Peso' },
  { code: 'IDR', symbol: 'Rp', decimals: 0, label: 'Indonesian Rupiah' },
  { code: 'VND', symbol: '₫', decimals: 0, label: 'Vietnamese Dong' },
  { code: 'INR', symbol: '₹', decimals: 2, label: 'Indian Rupee' },
  { code: 'AUD', symbol: 'A$', decimals: 2, label: 'Australian Dollar' },
  { code: 'CAD', symbol: 'C$', decimals: 2, label: 'Canadian Dollar' },
  { code: 'TWD', symbol: 'NT$', decimals: 2, label: 'Taiwan Dollar' },
];

export function currencyOf(code: string): Currency {
  return CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0];
}
