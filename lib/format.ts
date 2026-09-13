import { currencyOf } from './types';

export function uid(prefix = 'x'): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rand}`;
}

/** "1,600.50" -> 160050 minor units. Returns null when the text isn't a usable number. */
export function parseAmount(text: string, decimals: number): number | null {
  const cleaned = text.replace(/[,\s\u00a0]/g, '').replace(/[^\d.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 10 ** decimals);
}

export function toMajor(minor: number, decimals: number): number {
  return minor / 10 ** decimals;
}

/** Editable text for an input field — plain, no grouping separators. */
export function amountToInput(minor: number, decimals: number): string {
  if (minor === 0) return '';
  const major = toMajor(minor, decimals);
  return Number.isInteger(major) ? String(major) : major.toFixed(decimals);
}

/**
 * Money for display. Decimals only show up when they actually exist, so a table of
 * whole baht stays clean instead of a wall of ".00".
 */
export function formatMoney(
  minor: number,
  currencyCode: string,
  opts: { symbol?: boolean; sign?: boolean } = {},
): string {
  const { symbol = true, sign = false } = opts;
  const cur = currencyOf(currencyCode);
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const major = toMajor(abs, cur.decimals);

  const fractionDigits = cur.decimals === 0 || Number.isInteger(major) ? 0 : cur.decimals;
  const body = major.toLocaleString('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });

  const prefix = negative ? '−' : sign && minor > 0 ? '+' : '';
  return `${prefix}${symbol ? cur.symbol : ''}${body}`;
}

export function initialsOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const words = trimmed.split(/\s+/);
  if (words.length === 1) {
    return words[0].slice(0, words[0].length <= 2 ? 2 : 1).toUpperCase();
  }
  return (words[0][0] + words[1][0]).toUpperCase();
}
