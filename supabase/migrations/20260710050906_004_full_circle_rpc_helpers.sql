/*
# Full Circle Portal — RPC helper functions

## Overview
Adds two SQL helper functions:
- get_user_denarii_total: returns the sum of a user's ledger entries (signed)
- get_leaderboard_live: returns live denarii totals for all cadets with tent info, ranked
*/

CREATE OR REPLACE FUNCTION get_user_denarii_total(p_user_id uuid)
RETURNS bigint
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT COALESCE(SUM(amount), 0)::bigint FROM denarii_ledger_entries WHERE user_id = p_user_id;
$$;

DROP FUNCTION IF EXISTS get_leaderboard_live();
CREATE OR REPLACE FUNCTION get_leaderboard_live()
RETURNS TABLE (
  user_id uuid,
  display_name text,
  tent_id uuid,
  tent_house_id text,
  total_denarii bigint,
  rank int
)
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT
    p.id AS user_id,
    p.display_name,
    tm.tent_id,
    t.tent_house_id,
    COALESCE(SUM(d.amount), 0)::bigint AS total_denarii,
    RANK() OVER (ORDER BY COALESCE(SUM(d.amount), 0) DESC) AS rank
  FROM profiles p
  JOIN role_assignments ra ON ra.user_id = p.id AND ra.role = 'cadet' AND ra.status IN ('active','approved')
  LEFT JOIN tent_members tm ON tm.user_id = p.id
  LEFT JOIN tents t ON t.id = tm.tent_id
  LEFT JOIN denarii_ledger_entries d ON d.user_id = p.id
  GROUP BY p.id, p.display_name, tm.tent_id, t.tent_house_id
  ORDER BY total_denarii DESC;
$$;
