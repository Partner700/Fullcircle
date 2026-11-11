import { MOBILE_MONEY_APPROVAL_MS, MOBILE_MONEY_APPROVAL_SECONDS } from '../lib/mobileMoneyApproval';
import { useEffect, useRef, useState } from 'react';

export function MobileMoneyApprovalHelp({ method, startedAt, onTimeout }: {
  method?: string;
  startedAt?: string;
  onTimeout: () => void;
}) {
  const [openedAt] = useState(Date.now);
  const parsedStart = Date.parse(startedAt ?? '');
  const deadline = Number.isFinite(parsedStart) ? Math.min(parsedStart, openedAt) + MOBILE_MONEY_APPROVAL_MS : null;
  const [ended, setEnded] = useState(() => deadline !== null && deadline <= Date.now());
  const checkStatus = useRef(onTimeout);
  checkStatus.current = onTimeout;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setEnded(true);
      checkStatus.current();
    }, deadline === null ? 0 : Math.max(0, deadline - Date.now()));
    return () => window.clearTimeout(timer);
  }, [deadline]);

  if (deadline === null || ended) {
    return (
      <p role="status" className="text-sm text-stone">
        {deadline === null
          ? 'Your earlier payment is still pending.'
          : `The ${MOBILE_MONEY_APPROVAL_SECONDS}-second USSD approval window has ended.`}
        {' '}If you cancelled or didn’t enter your PIN, you can retry once the earlier payment shows as unsuccessful.
      </p>
    );
  }

  const wallet = method === 'mtn_momo' ? 'MTN MoMo (*126#)'
    : method === 'orange_money' ? 'Orange Money (#150#)'
    : 'MTN MoMo (*126#) or Orange Money (#150#)';
  return (
    <p className="text-sm text-stone">
      Enter your PIN on the phone prompt within {MOBILE_MONEY_APPROVAL_SECONDS} seconds.
      No prompt? On the SIM you entered, open {wallet} and look for a pending approval.
      Approve only the matching payment.
    </p>
  );
}
