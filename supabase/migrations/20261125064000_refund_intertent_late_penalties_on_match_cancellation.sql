-- Refunding a cancelled Inter-Tent match must be automatic and idempotent.
-- Prevent duplicate refund credits if the cancellation event is repeated.
CREATE UNIQUE INDEX IF NOT EXISTS intertent_cancel_refund_once_per_player
  ON public.denarii_ledger_entries(user_id,source_type,source_reference)
  WHERE source_type='admin_adjustment' AND source_reference LIKE 'intertent-cancel-refund:%';

CREATE OR REPLACE FUNCTION private.refund_cancelled_intertent_late_penalties()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.status <> 'cancelled' OR OLD.status='cancelled'
     OR NEW.room_name NOT ILIKE '%[intertent]%' THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.denarii_ledger_entries
    (user_id,amount,source_type,source_reference,description)
  SELECT charge.user_id,5000,'admin_adjustment',
         'intertent-cancel-refund:'||NEW.id::text,
         'Refund of 5,000D late penalty: Inter-Tent match cancelled'
  FROM public.denarii_ledger_entries charge
  WHERE charge.source_type='admin_adjustment' AND charge.amount=-5000
    AND charge.source_reference='intertent-late-final:'||NEW.id::text
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$function$
;

DROP TRIGGER IF EXISTS arena_cancel_refund_intertent_penalties ON public.arena_rooms;
CREATE TRIGGER arena_cancel_refund_intertent_penalties
AFTER UPDATE OF status ON public.arena_rooms
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status='cancelled')
EXECUTE FUNCTION private.refund_cancelled_intertent_late_penalties();
REVOKE ALL ON FUNCTION private.refund_cancelled_intertent_late_penalties() FROM PUBLIC,anon,authenticated;
