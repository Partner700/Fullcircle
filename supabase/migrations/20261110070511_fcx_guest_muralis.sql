-- Store FCX guest honors without attaching them to a Resident account.
CREATE TABLE IF NOT EXISTS private.fcx_guest_muralis (
  award_month date PRIMARY KEY CHECK (extract(day FROM award_month) = 1),
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  display_name text NOT NULL CHECK (btrim(display_name) <> ''),
  avatar_jpeg bytea NOT NULL CHECK (octet_length(avatar_jpeg) BETWEEN 1 AND 32768),
  created_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE private.fcx_guest_muralis FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_previous_muralis(p_event_month date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH member_winner(payload) AS (
    SELECT jsonb_build_object(
        'id', award.id,
        'award_month', award.award_month,
        'user_id', coalesce(award.user_id, CASE WHEN award.award_target_type <> 'tent' THEN award.award_target_id END),
        'award_type', award.award_type,
        'title', award.title,
        'description', award.description,
        'metric_value', award.metric_value,
        'award_target_type', award.award_target_type,
        'award_target_id', award.award_target_id,
        'created_at', award.created_at,
        'profiles', CASE WHEN profile.id IS NULL THEN NULL ELSE jsonb_build_object(
          'display_name', profile.display_name,
          'avatar_url', profile.avatar_url
        ) END,
        'recipient_tent', CASE WHEN tent.id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', tent.id,
          'name', tent.name,
          'tent_house_id', tent.tent_house_id
        ) END
      )
      FROM public.awards award
      LEFT JOIN public.profiles profile
        ON profile.id = coalesce(award.user_id, CASE WHEN award.award_target_type <> 'tent' THEN award.award_target_id END)
      LEFT JOIN LATERAL (
        SELECT member_tent.id, member_tent.name, member_tent.tent_house_id
        FROM public.tent_members member
        JOIN public.tents member_tent ON member_tent.id = member.tent_id
        WHERE member.user_id = profile.id
        ORDER BY member.joined_at DESC
        LIMIT 1
      ) tent ON true
      WHERE (
          lower(btrim(award.title)) IN ('muralis', 'muralis award')
          OR lower(btrim(coalesce(award.award_type, ''))) = 'muralis'
        )
        AND award.award_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
        AND award.award_month < to_char(p_event_month, 'YYYY-MM')
      ORDER BY award.award_month DESC, award.created_at DESC
      LIMIT 1
  ),
  guest_winner AS (
    SELECT *
    FROM private.fcx_guest_muralis
    WHERE award_month < date_trunc('month', p_event_month)::date
    ORDER BY award_month DESC
    LIMIT 1
  )
  SELECT CASE
    WHEN guest.id IS NOT NULL AND (
      member.payload IS NULL
      OR to_char(guest.award_month, 'YYYY-MM') > member.payload->>'award_month'
    ) THEN jsonb_build_object(
      'id', guest.id,
      'award_month', to_char(guest.award_month, 'YYYY-MM'),
      'user_id', NULL,
      'award_type', 'muralis',
      'title', 'Muralis',
      'award_target_type', 'guest',
      'created_at', guest.created_at,
      'profiles', jsonb_build_object(
        'display_name', guest.display_name,
        'avatar_url', 'data:image/jpeg;base64,' || replace(encode(guest.avatar_jpeg, 'base64'), chr(10), '')
      ),
      'recipient_tent', NULL
    )
    ELSE member.payload
  END
  FROM (SELECT 1) anchor
  LEFT JOIN member_winner member ON true
  LEFT JOIN guest_winner guest ON true;
$function$;

REVOKE ALL ON FUNCTION public.get_previous_muralis(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_previous_muralis(date) TO authenticated, service_role;
