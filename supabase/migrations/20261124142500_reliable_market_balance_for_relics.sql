-- Independent authenticated self-only fallback for Market balance reads.
-- Purchases continue to use the authoritative Denarii ledger in a transaction.
CREATE OR REPLACE FUNCTION public.get_my_market_denarii_balance()
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $func$
 SELECT coalesce(sum(entry.amount), 0)::bigint
 FROM public.denarii_ledger_entries entry
 WHERE entry.user_id=auth.uid() AND auth.uid() IS NOT NULL
$func$;
REVOKE ALL ON FUNCTION public.get_my_market_denarii_balance() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_market_denarii_balance() TO authenticated,service_role;
NOTIFY pgrst, 'reload schema';
