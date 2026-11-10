export function MobileMoneyApprovalHelp({ method }: { method?: string }) {
  const wallet = method === 'mtn_momo' ? 'MTN MoMo (*126#)'
    : method === 'orange_money' ? 'Orange Money (#150#)'
    : 'MTN MoMo (*126#) or Orange Money (#150#)';
  return (
    <p className="text-sm text-stone">
      Approve the carrier’s PIN prompt on the SIM you entered. If it doesn’t appear, check
      pending approvals in {wallet}, then return here to check the payment status.
      Enter your PIN only in the carrier prompt.
    </p>
  );
}
