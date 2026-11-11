export function MobileMoneyFailureMessage({ reason, approvalStartedAt }: {
  reason?: string | null;
  approvalStartedAt?: string;
}) {
  const insufficientFunds = /\binsufficient (?:funds|balance)\b|\bnot enough (?:funds|balance)\b/i.test(reason ?? '');
  const approvalAge = Date.now() - Date.parse(approvalStartedAt ?? '');
  if (reason === 'Payment approval expired.') {
    return 'Your USSD prompt expired before you approved the payment. Try again and enter your PIN on the new prompt as soon as it appears.';
  }
  if (reason === 'The checkout link expired.') {
    return 'The checkout link expired. Start a new payment to get a fresh link.';
  }
  if (reason?.startsWith('Fapshi did not create a payment request.')) {
    return 'No payment approval request was sent. Try starting the payment again.';
  }

  if (insufficientFunds || approvalAge < 20_000) {
    return (
      <>
        {insufficientFunds ? 'Your mobile money balance is too low for this purchase.' : 'The payment didn’t go through.'}{' '}
        <strong className="rounded bg-gold-soft px-0.5 font-bold text-ink">
          Check that your MTN MoMo or Orange Money balance covers the amount,
        </strong>
        {' '}then try again.
      </>
    );
  }
  if (approvalAge >= 20_000) {
    return 'The payment was unsuccessful. If the USSD prompt closed before you entered your PIN, try again and approve the new prompt within 20 seconds.';
  }
  return 'The payment was unsuccessful. Try again and approve the new prompt as soon as it appears.';
}
