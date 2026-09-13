'use client';

import type { Payee, Person } from '@/lib/types';
import { formatMoney } from '@/lib/format';
import { repaymentView } from '@/lib/split';
import { buildPromptPayPayload, describePromptPayId } from '@/lib/promptpay';
import { Avatar } from './Avatar';
import { Photo } from './Photo';
import { QrCode } from './QrCode';
import { Sheet } from './Sheet';
import { Arrow, Check } from './Icons';

export function PayQrSheet({
  from,
  to,
  amount,
  currencyCode,
  payee,
  hueFrom,
  hueTo,
  paid,
  onToggleSettled,
  onClose,
  readOnly = false,
}: {
  from: Person;
  to: Person;
  amount: number;
  currencyCode: string;
  payee: Payee | null;
  hueFrom: number;
  hueTo: number;
  /** How much of this payment has already been handed over. */
  paid: number;
  onToggleSettled: () => void;
  onClose: () => void;
  readOnly?: boolean;
}) {
  // What is actually owed right now — the QR and every figure below follow this,
  // so someone who has already paid half does not get asked for the whole again.
  const { paid: alreadyPaid, left: due, done: settled } = repaymentView(amount, paid);

  // A number lets us bake the amount into the code; a pasted image cannot carry one.
  const payload = payee?.promptPayId && due > 0 ? buildPromptPayPayload(payee.promptPayId, due) : null;
  const useGenerated = !!payload;

  return (
    <Sheet
      title="Pay up"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>
            Close
          </button>
          {!readOnly && (
            <button
              type="button"
              className={settled ? 'btn' : 'btn primary'}
              onClick={() => {
                onToggleSettled();
                onClose();
              }}
            >
              <Check size={16} />
              {settled ? 'Mark as not sent' : 'Mark as sent'}
            </button>
          )}
        </>
      }
    >
      <div className="pay-header">
        <span className="pay-people">
          <Avatar name={from.name} hue={hueFrom} size="xs" />
          <span className="nm">{from.name}</span>
          <span className="settle-arrow">
            <Arrow size={16} />
          </span>
          <Avatar name={to.name} hue={hueTo} size="xs" />
          <span className="nm">{to.name}</span>
        </span>
        <span className="pay-amount num">{formatMoney(due, currencyCode)}</span>
      </div>

      {alreadyPaid > 0 && (
        <p className="hint" style={{ marginTop: -3, marginBottom: 11, textAlign: 'center' }}>
          {formatMoney(alreadyPaid, currencyCode)} of {formatMoney(amount, currencyCode)} has already
          been paid{settled ? ' — nothing is left to send.' : ', so this is the rest.'}
        </p>
      )}

      {settled ? (
        <div className="empty">
          <strong>Already paid</strong>
          This one is done. Untick it below if that was a mistake.
        </div>
      ) : useGenerated ? (
        <>
          <div className="pay-qr-plate">
            <QrCode value={payload} size={260} />
          </div>
          <p className="hint" style={{ marginTop: 11, textAlign: 'center' }}>
            PromptPay to <b style={{ color: 'var(--text)' }}>{describePromptPayId(payee!.promptPayId!)}</b>
            {' — '}
            <b style={{ color: 'var(--accent)' }}>{formatMoney(due, currencyCode)} is already in the code</b>,
            so there is nothing to type in.
          </p>
          <p className="hint" style={{ marginTop: 9, textAlign: 'center' }}>
            Always check the name your banking app shows before confirming.
          </p>
        </>
      ) : payee?.qrPhotoId ? (
        <>
          <div className="pay-qr-plate">
            <Photo id={payee.qrPhotoId} kind="full" alt={`${to.name}'s payment QR`} />
          </div>
          <p className="hint" style={{ marginTop: 11, textAlign: 'center' }}>
            {to.name}&rsquo;s own QR. It has no amount in it, so type{' '}
            <b style={{ color: 'var(--accent)' }}>{formatMoney(due, currencyCode)}</b> yourself.
          </p>
        </>
      ) : (
        <div className="empty">
          <strong>No payment QR yet</strong>
          {readOnly
            ? `${to.name} has not added a PromptPay number, or added a QR picture instead — pictures stay with the people on the event and do not travel in a link. Ask them for a number and this will build the code for you.`
            : `${to.name} hasn’t added one. Tap their avatar in the members list to paste a QR screenshot or type a PromptPay number.`}
        </div>
      )}
    </Sheet>
  );
}
