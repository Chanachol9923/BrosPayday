/**
 * PromptPay QR payloads (the Thai EMVCo QR standard).
 *
 * The payload is nested tag-length-value. A QR carrying an amount is a "dynamic"
 * one-time code; without an amount it is the reusable "static" code you would print
 * and stick on a wall. Everything ends with a CRC-16/CCITT-FALSE over the whole
 * string including the "6304" tag that introduces it.
 *
 * The failure mode of a malformed payload is a QR that simply will not scan — a
 * banking app validates the CRC before showing anything — so a mistake here cannot
 * silently send money somewhere unintended. The recipient digits still come from
 * whatever the user typed, so those are worth reading back to them.
 */

const AID_PROMPTPAY = 'A000000677010111';

const TAG_PAYLOAD_FORMAT = '00';
const TAG_POINT_OF_INITIATION = '01';
const TAG_MERCHANT_ACCOUNT = '29';
const TAG_CURRENCY = '53';
const TAG_AMOUNT = '54';
const TAG_COUNTRY = '58';
const TAG_CRC = '63';

const TARGET_MOBILE = '01';
const TARGET_NATIONAL_ID = '02';
const TARGET_EWALLET = '03';

const CURRENCY_THB = '764';
const COUNTRY_TH = 'TH';

export type PromptPayKind = 'mobile' | 'nationalId' | 'ewallet';

export type PromptPayTarget = {
  kind: PromptPayKind;
  /** The digits as they go into the payload. */
  value: string;
};

function tlv(id: string, value: string): string {
  return id + String(value.length).padStart(2, '0') + value;
}

/** CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF, no reflection, no final xor. */
export function crc16(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Work out what kind of PromptPay id some typed digits are.
 * Phone numbers become 0066 + the 9 digits after the leading zero.
 */
export function parsePromptPayId(raw: string): PromptPayTarget | null {
  const digits = (raw ?? '').replace(/\D/g, '');

  if (digits.length === 10 && digits.startsWith('0')) {
    return { kind: 'mobile', value: `0066${digits.slice(1)}` };
  }
  if (digits.length === 9) {
    return { kind: 'mobile', value: `0066${digits}` };
  }
  if (digits.length === 13) {
    return { kind: 'nationalId', value: digits };
  }
  if (digits.length === 15) {
    return { kind: 'ewallet', value: digits };
  }
  return null;
}

export function describePromptPayId(raw: string): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('0')) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 13) {
    return `${digits.slice(0, 1)}-${digits.slice(1, 5)}-${digits.slice(5, 10)}-${digits.slice(10, 12)}-${digits.slice(12)}`;
  }
  return digits;
}

export function promptPayKindLabel(kind: PromptPayKind): string {
  return kind === 'mobile' ? 'phone number' : kind === 'nationalId' ? 'ID number' : 'e-wallet';
}

/**
 * Build the payload string that goes into the QR.
 *
 * @param rawId  the recipient's phone number, national/tax id, or e-wallet id
 * @param amountMinor  amount in satang; omit or 0 for a reusable code with no amount
 */
export function buildPromptPayPayload(rawId: string, amountMinor = 0): string | null {
  const target = parsePromptPayId(rawId);
  if (!target) return null;

  const hasAmount = Number.isFinite(amountMinor) && amountMinor > 0;

  const targetTag =
    target.kind === 'mobile'
      ? TARGET_MOBILE
      : target.kind === 'nationalId'
        ? TARGET_NATIONAL_ID
        : TARGET_EWALLET;

  const merchantAccount = tlv(TAG_MERCHANT_ACCOUNT, tlv('00', AID_PROMPTPAY) + tlv(targetTag, target.value));

  let payload =
    tlv(TAG_PAYLOAD_FORMAT, '01') +
    tlv(TAG_POINT_OF_INITIATION, hasAmount ? '12' : '11') +
    merchantAccount +
    tlv(TAG_CURRENCY, CURRENCY_THB);

  if (hasAmount) payload += tlv(TAG_AMOUNT, (amountMinor / 100).toFixed(2));

  payload += tlv(TAG_COUNTRY, COUNTRY_TH);

  // The CRC covers its own tag and length, so append "6304" before computing it.
  const withCrcTag = `${payload}${TAG_CRC}04`;
  return withCrcTag + crc16(withCrcTag);
}

/** Flat TLV reader, used by the tests to prove a payload says what it should. */
export function parseTlv(payload: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i + 4 <= payload.length) {
    const id = payload.slice(i, i + 2);
    const len = Number(payload.slice(i + 2, i + 4));
    if (!Number.isFinite(len)) break;
    out[id] = payload.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return out;
}

/** True when the trailing CRC matches the rest of the payload. */
export function verifyPromptPayPayload(payload: string): boolean {
  if (payload.length < 8) return false;
  const body = payload.slice(0, -4);
  const found = payload.slice(-4);
  return body.endsWith(`${TAG_CRC}04`) && crc16(body) === found.toUpperCase();
}
