-- Participants may watch the resolved questions and answers in their own room.
CREATE OR REPLACE FUNCTION public.get_arena_trivia_feed(p_room_id uuid)
RETURNS TABLE(
  user_id uuid,
  display_name text,
  avatar_url text,
  question_index integer,
  submitted_answer text,
  is_correct boolean,
  figs_earned integer,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.arena_participants ap
    WHERE ap.room_id = p_room_id AND ap.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Only participants can watch this Arena feed.';
  END IF;

  RETURN QUERY
  SELECT r.user_id, p.display_name, p.avatar_url, r.question_index,
    r.submitted_answer, r.is_correct, r.figs_earned, r.created_at
  FROM public.arena_trivia_responses r
  JOIN public.profiles p ON p.id = r.user_id
  WHERE r.room_id = p_room_id
  ORDER BY r.created_at DESC
  LIMIT 40;
END;
$$;

REVOKE ALL ON FUNCTION public.get_arena_trivia_feed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_arena_trivia_feed(uuid) TO authenticated;

-- Sentries may read meditation history only for current cadets in their tent.
DROP POLICY IF EXISTS "sentries read their cadets meditation history" ON public.daily_records;
CREATE POLICY "sentries read their cadets meditation history"
ON public.daily_records FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.tent_members cadet
    JOIN public.tents t ON t.id = cadet.tent_id
    LEFT JOIN public.tent_members sentry
      ON sentry.tent_id = cadet.tent_id
      AND sentry.user_id = auth.uid()
      AND sentry.role = 'sentry'
    WHERE cadet.user_id = daily_records.user_id
      AND cadet.role = 'cadet'
      AND (t.sentry_id = auth.uid() OR sentry.id IS NOT NULL)
  )
);

-- The instructor needs the complete archive for pastoral oversight.
DROP POLICY IF EXISTS "instructors read all meditation history" ON public.daily_records;
CREATE POLICY "instructors read all meditation history"
ON public.daily_records FOR SELECT TO authenticated
USING (public.is_instructor(auth.uid()));
