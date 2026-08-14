/*
# Quote stat chips and arena completion guard

- Extends today's quote feed with current streak, figs, and rhudes.
- Keeps completed arena rooms authoritative over late inactivity notices.
*/

DROP FUNCTION IF EXISTS public.get_daily_quote_feed(integer);

CREATE OR REPLACE FUNCTION public.get_daily_quote_feed(p_limit integer DEFAULT 12)
RETURNS TABLE (
  record_date date,
  daily_quote text,
  user_id uuid,
  display_name text,
  avatar_url text,
  current_streak integer,
  total_figs integer,
  rhudes integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH clock AS (
    SELECT timezone('Africa/Douala', now())::date AS today
  )
  SELECT
    dr.record_date,
    dr.daily_quote,
    dr.user_id,
    p.display_name,
    p.avatar_url,
    COALESCE(marks.current_streak, (SELECT current_streak FROM public.compute_strict_streak(dr.user_id) LIMIT 1), 0)::integer AS current_streak,
    COALESCE(marks.total_figs, 0)::integer AS total_figs,
    COALESCE(marks.rhudes, 0)::integer AS rhudes
  FROM public.daily_records dr
  JOIN public.profiles p ON p.id = dr.user_id
  LEFT JOIN public.get_marks_board_live() marks ON marks.user_id = dr.user_id
  CROSS JOIN clock c
  WHERE dr.meditation_submitted = true
    AND dr.record_date = c.today
    AND NULLIF(btrim(dr.daily_quote), '') IS NOT NULL
  ORDER BY dr.meditation_submitted_at DESC NULLS LAST, p.display_name ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 12), 1), 30);
$$;

GRANT EXECUTE ON FUNCTION public.get_daily_quote_feed(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.heartbeat_arena_participant(p_room_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room_status text;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'You can only update your own arena presence.';
  END IF;

  SELECT status INTO v_room_status FROM public.arena_rooms WHERE id = p_room_id;
  IF v_room_status = 'completed' THEN
    RETURN true;
  END IF;

  PERFORM public.expire_inactive_arena_participants();
  UPDATE public.arena_participants participant
  SET last_active_at = now()
  FROM public.arena_rooms room
  WHERE participant.room_id = p_room_id
    AND participant.user_id = p_user_id
    AND participant.room_id = room.id
    AND room.status = 'playing'
    AND participant.forfeited_at IS NULL;
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.heartbeat_arena_participant(uuid, uuid) TO authenticated;
