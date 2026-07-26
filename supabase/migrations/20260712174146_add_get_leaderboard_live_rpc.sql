/*
# Add get_leaderboard_live RPC

Returns a live denarii leaderboard by calling get_user_denarii_total
for every cadet and joining with their tent house. Returns:
user_id, display_name, tent_house_id, total_denarii, rank.

This is used by the Challenge Boards (Denarii tab) for real-time ranking.
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
  -- Gather totals for all active cadets
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

  -- Return sorted with rank
  RETURN QUERY
  SELECT
    (key::uuid) AS user_id,
    p.display_name,
    tm.tent_houses_id AS tent_house_id,
    (value::text)::bigint AS total_denarii,
    ROW_NUMBER() OVER (ORDER BY (value::text)::bigint DESC) AS rank
  FROM jsonb_each_text(v_totals)
  LEFT JOIN profiles p ON p.id = (key::uuid)
  LEFT JOIN LATERAL (
    SELECT t.tent_houses_id
    FROM tent_members tm2
    JOIN tents t ON t.id = tm2.tent_id
    WHERE tm2.user_id = (key::uuid)
    LIMIT 1
  ) tm ON true
  ORDER BY total_denarii DESC;
END;
$$;
