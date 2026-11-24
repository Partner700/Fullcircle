import { MOBILE_MONEY_APPROVAL_MS, MOBILE_MONEY_APPROVAL_SECONDS } from '../lib/mobileMoneyApproval';

export function MobileMoneyFailureMessage({ reason, approvalStartedAt }: {
  reason?: string | null;
  approvalStartedAt?: string;
}) {
  const message = reason?.trim() ?? '';
  const insufficientFunds = /\binsufficient (?:funds|balance)\b|\bnot enough (?:funds|balance)\b/i.test(message);
  const startedAt = approvalStartedAt ? Date.parse(approvalStartedAt) : NaN;
  const approvalAge = Number.isFinite(startedAt) ? Date.now() - startedAt : NaN;

  if (message === 'Payment approval expired.') {
    return 'The USSD request expired before approval. Check your phone for the next prompt and enter your PIN promptly.';
  }
  if (message === 'The checkout link expired.') {
    return 'The checkout link expired. Start a new payment to get a fresh link.';
  }
  if (message.startsWith('Fapshi did not create a payment request.')) {
    return 'The provider did not send a payment request. No payment was confirmed. Check the number and request a new prompt.';
  }
  if (insufficientFunds) {
    return 'The mobile money provider reported insufficient funds for this transaction. Full Circle cannot inspect your wallet balance. Check the total and the selected mobile money number, then try a fresh payment prompt or another number.';
  }
  if (Number.isFinite(approvalAge) && approvalAge >= MOBILE_MONEY_APPROVAL_MS) {
    return `The payment was not confirmed. This does not mean your balance is low. If the USSD prompt closed, request a fresh prompt and approve it within ${MOBILE_MONEY_APPROVAL_SECONDS} seconds.`;
  }
  return 'The payment was not completed. Your wallet balance has not been verified. Check the selected number and network, then request a fresh mobile money prompt. You will only receive your purchase after the provider confirms payment.';
}
