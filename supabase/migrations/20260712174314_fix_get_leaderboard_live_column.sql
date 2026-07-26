/*
# Fix get_leaderboard_live: correct column name

The tents table uses `tent_house_id` (singular), not `tent_houses_id`.
This migration drops and recreates the function with the correct column.
*/

DROP FUNCTION IF EXISTS get_leaderboard_live();
CREATE OR REPLACE FUNCTION get_leaderboard_live()
RETURNS TABLE (
  user_id uuid,
  display_name text,
  tent_house_id text,
  total_denarii bigint,
  rank integer
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cadet record;
  v_totals jsonb := '{}'::jsonb;
BEGIN
  FOR v_cadet IN
    SELECT DISTINCT ra.user_id, p.display_name
    FROM role_assignments ra
    JOIN profiles p ON p.id = ra.user_id
    WHERE ra.role = 'cadet' AND ra.status = 'active'
  LOOP
    v_totals := jsonb_set(
      v_totals,
      ('"' || v_cadet.user_id::text || '"')::text[],
      to_jsonb(get_user_denarii_total(v_cadet.user_id))
    );
  END LOOP;

  RETURN QUERY
  SELECT
    (key::uuid) AS user_id,
    p.display_name,
    tm.tent_house_id AS tent_house_id,
    (value::text)::bigint AS total_denarii,
    ROW_NUMBER() OVER (ORDER BY (value::text)::bigint DESC) AS rank
  FROM jsonb_each_text(v_totals)
  LEFT JOIN profiles p ON p.id = (key::uuid)
  LEFT JOIN LATERAL (
    SELECT t.tent_house_id
    FROM tent_members tm2
    JOIN tents t ON t.id = tm2.tent_id
    WHERE tm2.user_id = (key::uuid)
    LIMIT 1
  ) tm ON true
  ORDER BY total_denarii DESC;
END;
$$;
