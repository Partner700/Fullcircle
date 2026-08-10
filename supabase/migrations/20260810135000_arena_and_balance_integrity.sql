/* Close direct Arena mutations and prevent concurrent overspending. */

DROP POLICY IF EXISTS "arena_rooms_insert" ON public.arena_rooms;
DROP POLICY IF EXISTS "arena_rooms_update" ON public.arena_rooms;
DROP POLICY IF EXISTS "arena_participants_insert" ON public.arena_participants;
DROP POLICY IF EXISTS "arena_participants_update" ON public.arena_participants;

REVOKE INSERT, UPDATE, DELETE ON public.arena_rooms FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.arena_participants FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.prevent_negative_denarii_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance bigint;
BEGIN
  IF NEW.amount >= 0 THEN
    RETURN NEW;
  END IF;

  -- One transaction at a time may debit a user's ledger. This protects every
  -- purchase/stake RPC, including older callers, from a double-spend race.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text, 0));
  SELECT coalesce(sum(entry.amount), 0)
  INTO v_balance
  FROM public.denarii_ledger_entries entry
  WHERE entry.user_id = NEW.user_id;

  IF v_balance + NEW.amount < 0 THEN
    RAISE EXCEPTION 'Insufficient denarii. This transaction needs % but only % is available.',
      abs(NEW.amount), v_balance;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_nonnegative_denarii_balance ON public.denarii_ledger_entries;
CREATE TRIGGER enforce_nonnegative_denarii_balance
BEFORE INSERT ON public.denarii_ledger_entries
FOR EACH ROW EXECUTE FUNCTION public.prevent_negative_denarii_balance();

REVOKE ALL ON FUNCTION public.prevent_negative_denarii_balance() FROM PUBLIC, anon, authenticated;

-- SECURITY DEFINER functions are executable by PUBLIC unless explicitly
-- revoked. Every browser-facing Arena action must require an authenticated JWT.
REVOKE ALL ON FUNCTION public.create_arena_room(uuid, text, integer, integer, text, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_machine_arena_room(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.invite_arena_players(uuid, uuid, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.join_arena_room(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.start_arena_game(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_arena_room(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.heartbeat_arena_participant(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.forfeit_arena_game(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finish_arena_game(uuid, uuid, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.expire_stale_arena_rooms() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.expire_inactive_arena_participants() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.settle_standard_arena_forfeit(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_arena_room(uuid, text, integer, integer, text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_machine_arena_room(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_arena_players(uuid, uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_arena_room(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_arena_game(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_arena_room(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_arena_participant(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forfeit_arena_game(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finish_arena_game(uuid, uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_arena_rooms() TO authenticated;
GRANT EXECUTE ON FUNCTION public.expire_inactive_arena_participants() TO authenticated;

