import { useEffect, useRef, useState } from 'react';

export function MobileMoneyApprovalHelp({ method, startedAt, onTimeout }: {
  method?: string;
  startedAt?: string;
  onTimeout: () => void;
}) {
  const [openedAt] = useState(Date.now);
  const parsedStart = Date.parse(startedAt ?? '');
  const deadline = Number.isFinite(parsedStart) ? Math.min(parsedStart, openedAt) + 20_000 : null;
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
          ? 'Full Circle is checking the existing payment request.'
          : 'The 20-second USSD approval window has ended. If you didn’t enter your PIN, wait for the payment status before requesting a new prompt.'}
        {' '}Full Circle will update this payment as soon as Fapshi confirms the result.
      </p>
    );
  }

  const wallet = method === 'mtn_momo' ? 'MTN MoMo (*126#)'
    : method === 'orange_money' ? 'Orange Money (#150#)'
    : 'MTN MoMo (*126#) or Orange Money (#150#)';
  return (
    <p className="text-sm text-stone">
      Enter your PIN on the phone prompt within 20 seconds.
      No prompt? On the SIM you entered, open {wallet} and look for a pending approval.
      Approve only the matching payment.
    </p>
  );
}
