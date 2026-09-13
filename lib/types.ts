export type Person = {
  id: string;
  name: string;
};

/** A photo attached to a party — a receipt snapped while shopping, usually. */
export type PhotoMeta = {
  id: string;
  /** Optionally tied to one expense; null means it is just on the party. */
  expenseId: string | null;
  w: number;
  h: number;
  bytes: number;
  addedAt: number;
  note?: string;
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
  photos: PhotoMeta[];
  /**
   * How much of each suggested payment has actually changed hands, keyed
   * `fromPersonId>toPersonId` in minor units. Purely a record: it never feeds
   * back into the split, so the arithmetic and its proof stay put.
   */
  repayments: Record<string, number>;
  createdAt: number;
  updatedAt: number;
};

/**
 * How to pay one person back. Kept per profile and matched on name rather than
 * on a party's person id, so setting it once carries across every future party.
 * Both fields are optional — nobody has to provide anything.
 */
export type Payee = {
  name: string;
  /** Photo id of a QR screenshot they pasted in. */
  qrPhotoId?: string | null;
  /** A PromptPay phone/ID number, which lets us build a QR with the amount in it. */
  promptPayId?: string | null;
  updatedAt: number;
};

/** A local profile. No password, no account — just whose history this is. */
export type Profile = {
  id: string;
  name: string;
  createdAt: number;
};

/** A reusable party template: the same line-up, the same usual expenses. */
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
  /** profileId -> how to pay each person back, keyed by lowercased name */
  payees: Record<string, Record<string, Payee>>;
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
