/*
  Direct restoration for Victoire.

  The general Thief's Request audits repaired the normal data shapes, but one
  Victoire profile remains wrong. This intentionally repairs the matching
  profile directly by adding relic protection to every eligible missed streak
  day up to the current recoverable day.
*/

DO $$
DECLARE
  v_user record;
  v_join_date date;
  v_cutoff_date date := timezone('Africa/Douala', now())::date
    - CASE WHEN timezone('Africa/Douala', now())::time >= time '21:00' THEN 0 ELSE 1 END;
  v_restore_date date;
BEGIN
  FOR v_user IN
    SELECT profile.id, profile.display_name, profile.email, profile.created_at
    FROM public.profiles profile
    WHERE profile.display_name ILIKE '%victoire%'
       OR profile.email ILIKE '%victoire%'
    ORDER BY
      CASE WHEN profile.display_name ILIKE '%ebo%' OR profile.email ILIKE '%ebo%' THEN 0 ELSE 1 END,
      profile.created_at DESC
  LOOP
    v_join_date := (v_user.created_at AT TIME ZONE 'Africa/Douala')::date;

    IF v_join_date IS NULL OR v_cutoff_date < v_join_date THEN
      CONTINUE;
    END IF;

    FOR v_restore_date IN
      SELECT day::date
      FROM generate_series(v_join_date, v_cutoff_date, interval '1 day') AS day
      WHERE (
        extract(dow FROM day) BETWEEN 1 AND 5
        OR (
          extract(dow FROM day) = 6
          AND EXISTS (
            SELECT 1
            FROM public.quiz_sessions session
            WHERE session.session_date = day::date
              AND session.quiz_type = 'saturday'
          )
        )
      )
      AND NOT public.streak_requirement_met(v_user.id, day::date)
      AND NOT EXISTS (
        SELECT 1
        FROM public.streak_freezers protected
        WHERE protected.user_id = v_user.id
          AND protected.used_at IS NULL
          AND protected.applied_to_date = day::date
      )
      ORDER BY day::date
    LOOP
      INSERT INTO public.streak_freezers (user_id, freezer_type, source, applied_to_date)
      VALUES (v_user.id, 'weekly', 'relic', v_restore_date);
    END LOOP;
  END LOOP;
END;
$$;
