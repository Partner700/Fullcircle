-- Eligibility refreshes forward streak records, so PostgREST must use a write-capable transaction.
ALTER FUNCTION public.get_my_valediction_status() VOLATILE;
NOTIFY pgrst, 'reload schema';
