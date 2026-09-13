'use client';

import type { Payee, Person } from '@/lib/types';
import { formatMoney } from '@/lib/format';
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
  settled,
  onToggleSettled,
  onClose,
}: {
  from: Person;
  to: Person;
  amount: number;
  currencyCode: string;
  payee: Payee | null;
  hueFrom: number;
  hueTo: number;
  settled: boolean;
  onToggleSettled: () => void;
  onClose: () => void;
}) {
  // A number lets us bake the amount into the code; a pasted image cannot carry one.
  const payload = payee?.promptPayId ? buildPromptPayPayload(payee.promptPayId, amount) : null;
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
        <span className="pay-amount num">{formatMoney(amount, currencyCode)}</span>
      </div>

      {useGenerated ? (
        <>
          <div className="pay-qr-plate">
            <QrCode value={payload} size={260} />
          </div>
          <p className="hint" style={{ marginTop: 11, textAlign: 'center' }}>
            PromptPay to <b style={{ color: 'var(--text)' }}>{describePromptPayId(payee!.promptPayId!)}</b>
            {' — '}
            <b style={{ color: 'var(--accent)' }}>{formatMoney(amount, currencyCode)} is already in the code</b>,
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
            <b style={{ color: 'var(--accent)' }}>{formatMoney(amount, currencyCode)}</b> yourself.
          </p>
        </>
      ) : (
        <div className="empty">
          <strong>No payment QR yet</strong>
          {to.name} hasn&rsquo;t added one. Tap their avatar in the members list to paste a QR
          screenshot or type a PromptPay number.
        </div>
      )}
    </Sheet>
  );
}
