export function MobileMoneyApprovalHelp({ method }: { method?: string }) {
  const wallet = method === 'mtn_momo' ? 'MTN MoMo (*126#)'
    : method === 'orange_money' ? 'Orange Money (#150#)'
    : 'MTN MoMo (*126#) or Orange Money (#150#)';
  return (
    <p className="text-sm text-stone">
      Approve the prompt as soon as it appears. It can expire in about 20 seconds.
      No prompt? On the SIM you entered, open {wallet} and look for a pending approval.
      Approve only the matching payment. Check the status here before trying again.
    </p>
  );
}
