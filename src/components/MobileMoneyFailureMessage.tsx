export function MobileMoneyFailureMessage({ reason }: { reason?: string | null }) {
  if (/\binsufficient (?:funds|balance)\b|\bnot enough (?:funds|balance)\b/i.test(reason ?? '')) {
    return 'Your MTN MoMo or Orange Money balance is too low for this purchase. Add funds, then try again.';
  }

  if (reason === 'Payment approval expired.') {
    return 'The approval prompt expired before the payment was approved. Try again and approve the new prompt as soon as it appears.';
  }
  if (reason === 'The checkout link expired.') {
    return 'The checkout link expired. Start a new payment to get a fresh link.';
  }
  if (reason?.startsWith('Fapshi did not create a payment request.')) {
    return 'No payment approval request was sent. Try starting the payment again.';
  }

  return (
    <>
      The payment didn’t go through.{' '}
      <strong className="rounded bg-gold-soft px-0.5 font-bold text-ink">
        Check that your MTN MoMo or Orange Money balance covers the amount,
      </strong>
      {' '}then try again. Approve the new prompt as soon as it appears.
    </>
  );
}
