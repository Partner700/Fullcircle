/*
  Bulk instructor treasury grants.

  The existing single-recipient function remains the one authoritative grant
  path. This wrapper validates and deduplicates the recipient list, then calls
  that function for every member inside one database transaction. If any grant
  fails, none of the selected members receive a partial grant.
*/

CREATE OR REPLACE FUNCTION public.grant_instructor_resources_bulk(
  p_recipient_ids uuid[],
  p_denarii_amount integer DEFAULT 0,
  p_relic_type_id uuid DEFAULT NULL,
  p_relic_quantity integer DEFAULT 0,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_recipient_ids uuid[];
  v_recipient_id uuid;
  v_grant jsonb;
  v_grants jsonb := '[]'::jsonb;
  v_recipient_count integer := 0;
BEGIN
  IF v_actor IS NULL OR NOT public.is_instructor(v_actor) THEN
    RAISE EXCEPTION 'Only the instructor can grant camp resources.' USING ERRCODE = '42501';
  END IF;

  SELECT array_agg(candidate.recipient_id ORDER BY candidate.first_position)
  INTO v_recipient_ids
  FROM (
    SELECT recipient_id, min(ordinality_index) AS first_position
    FROM unnest(coalesce(p_recipient_ids, ARRAY[]::uuid[]))
      WITH ORDINALITY AS supplied(recipient_id, ordinality_index)
    WHERE recipient_id IS NOT NULL
    GROUP BY recipient_id
  ) candidate;

  v_recipient_count := coalesce(cardinality(v_recipient_ids), 0);
  IF v_recipient_count = 0 THEN
    RAISE EXCEPTION 'Choose at least one recipient.';
  END IF;
  IF v_recipient_count > 250 THEN
    RAISE EXCEPTION 'Choose no more than 250 recipients at once.';
  END IF;

  FOREACH v_recipient_id IN ARRAY v_recipient_ids LOOP
    v_grant := public.grant_instructor_resources(
      v_recipient_id,
      coalesce(p_denarii_amount, 0),
      CASE WHEN coalesce(p_relic_quantity, 0) > 0 THEN p_relic_type_id ELSE NULL END,
      coalesce(p_relic_quantity, 0),
      p_note
    );
    v_grants := v_grants || jsonb_build_array(v_grant);
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'recipient_count', v_recipient_count,
    'grants', v_grants
  );
END;
$$;

REVOKE ALL ON FUNCTION public.grant_instructor_resources_bulk(uuid[], integer, uuid, integer, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_instructor_resources_bulk(uuid[], integer, uuid, integer, text)
  TO authenticated, service_role;
