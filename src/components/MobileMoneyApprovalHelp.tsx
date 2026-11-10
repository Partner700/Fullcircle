export function MobileMoneyApprovalHelp({ method }: { method?: string }) {
  const wallet = method === 'mtn_momo' ? 'MTN MoMo (*126#)'
    : method === 'orange_money' ? 'Orange Money (#150#)'
    : 'MTN MoMo (*126#) or Orange Money (#150#)';
  return (
    <p className="text-sm text-stone">
      No prompt? On the SIM you entered, open {wallet} and look for a pending approval.
      Approve only the matching payment. Check the status here before trying again.
    </p>
  );
}
