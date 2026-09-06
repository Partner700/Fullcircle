/* One current award badge per avatar, public Sunday honors, and intentional
   quiz-exit forfeiture without reviving false background forfeits. */

CREATE OR REPLACE FUNCTION public.get_current_avatar_awards()
RETURNS TABLE (user_id uuid, award_type text, title text, cadence text)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  WITH clock AS (
    SELECT timezone('Africa/Douala', statement_timestamp())::date AS today
  ), cycles AS (
    SELECT
      to_char(today, 'YYYY-MM') AS month_cycle,
      'week-' || to_char(today - (extract(isodow FROM today)::integer - 1), 'YYYY-MM-DD') AS week_cycle
    FROM clock
  ), eligible AS (
    SELECT
      coalesce(award.user_id, CASE WHEN award.award_target_type <> 'tent' THEN award.award_target_id END) AS recipient_id,
      award.award_type,
      award.title,
      CASE WHEN award.award_month = cycles.month_cycle THEN 'monthly' ELSE 'weekly' END AS cadence,
      row_number() OVER (
        PARTITION BY coalesce(award.user_id, CASE WHEN award.award_target_type <> 'tent' THEN award.award_target_id END)
        ORDER BY
          CASE WHEN award.award_month = cycles.month_cycle THEN 2 ELSE 1 END DESC,
          CASE lower(btrim(award.title))
            WHEN 'grand vallum' THEN 100 WHEN 'vallum' THEN 95
            WHEN 'muralis' THEN 92 WHEN 'centurion' THEN 90
            WHEN 'monthly scribe' THEN 85 WHEN 'monthly valley champion' THEN 84
            WHEN 'angel award (angelos)' THEN 70 WHEN 'rumor award' THEN 68
            WHEN 'scribe award' THEN 66 ELSE 50
          END DESC,
          award.created_at DESC,
          award.id DESC
      ) AS choice
    FROM public.awards award
    CROSS JOIN cycles
    WHERE coalesce(award.award_target_type, 'cadet') <> 'tent'
      AND award.award_month IN (cycles.month_cycle, cycles.week_cycle)
      AND coalesce(award.user_id, award.award_target_id) IS NOT NULL
  )
  SELECT recipient_id, award_type, title, cadence
  FROM eligible
  WHERE choice = 1;
$$;

REVOKE ALL ON FUNCTION public.get_current_avatar_awards() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_current_avatar_awards() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_public_rest_day_awards(p_reading_date date)
RETURNS TABLE (
  id uuid, award_type text, title text, description text, cadence text,
  user_id uuid, display_name text, avatar_url text, tent_house_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_month_cycle text := to_char(p_reading_date, 'YYYY-MM');
  v_week_cycle text := 'week-' || to_char(p_reading_date - (extract(isodow FROM p_reading_date)::integer - 1), 'YYYY-MM-DD');
BEGIN
  IF extract(isodow FROM p_reading_date)::integer <> 7 THEN RETURN; END IF;
  RETURN QUERY
  SELECT
    award.id, award.award_type, award.title, award.description,
    CASE WHEN award.award_month = v_month_cycle THEN 'monthly' ELSE 'weekly' END,
    CASE WHEN coalesce(award.award_target_type, 'cadet') = 'tent' THEN NULL ELSE coalesce(award.user_id, award.award_target_id) END,
    coalesce(profile.display_name, tent.name, 'Full Circle honor'),
    coalesce(profile.avatar_url, tent.profile_image_url),
    coalesce(member_tent.tent_house_id, tent.tent_house_id)
  FROM public.awards award
  LEFT JOIN public.profiles profile
    ON profile.id = CASE
      WHEN coalesce(award.award_target_type, 'cadet') <> 'tent' THEN coalesce(award.user_id, award.award_target_id)
      ELSE NULL
    END
  LEFT JOIN public.tent_members membership ON membership.user_id = profile.id
  LEFT JOIN public.tents member_tent ON member_tent.id = membership.tent_id
  LEFT JOIN public.tents tent
    ON coalesce(award.award_target_type, 'cadet') = 'tent' AND tent.id = award.award_target_id
  WHERE award.award_month IN (v_month_cycle, v_week_cycle)
  ORDER BY CASE WHEN award.award_month = v_month_cycle THEN 2 ELSE 1 END DESC, award.created_at DESC, award.id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_rest_day_awards(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_rest_day_awards(date) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.forfeit_quiz_attempt_on_exit(p_attempt_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  UPDATE public.quiz_attempts
  SET status = 'forfeited', forfeited_at = clock_timestamp()
  WHERE id = p_attempt_id AND user_id = auth.uid() AND status = 'in_progress';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.forfeit_quiz_attempt_on_exit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.forfeit_quiz_attempt_on_exit(uuid) TO authenticated, service_role;
