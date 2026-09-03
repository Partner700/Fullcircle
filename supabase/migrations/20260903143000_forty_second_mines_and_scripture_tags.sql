/* Forty-second hidden questions and Scripture Mine verse-tag behavior. */

CREATE OR REPLACE FUNCTION public.enforce_hidden_challenge_fifteen_seconds()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'opened' AND OLD.status IS DISTINCT FROM 'opened' THEN
    NEW.opened_at := clock_timestamp();
    NEW.attempt_deadline := NEW.opened_at + interval '40 seconds';
  ELSIF NEW.status = 'opened'
    AND OLD.status = 'opened'
    AND NEW.attempt_deadline IS DISTINCT FROM OLD.attempt_deadline
    AND NEW.attempt_deadline > clock_timestamp()
    AND NEW.attempt_deadline <= clock_timestamp() + interval '20 seconds'
  THEN
    /* The existing Freeze Timer relic requests 15 seconds. Promote that
       request to the new full answer window before it is stored. */
    NEW.attempt_deadline := clock_timestamp() + interval '40 seconds';
  END IF;
  RETURN NEW;
END;
$$;

UPDATE public.hidden_challenge_claims
SET attempt_deadline = greatest(
  coalesce(attempt_deadline, clock_timestamp()),
  clock_timestamp() + interval '40 seconds'
)
WHERE status = 'opened';

CREATE OR REPLACE FUNCTION public.get_my_pending_hidden_verse_markers(
  p_narrative_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  claim_id uuid,
  reference_key text,
  item_type text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT claim.id, claim.reference_key, challenge.item_type
  FROM public.hidden_challenge_claims claim
  JOIN public.hidden_challenges challenge ON challenge.id = claim.challenge_id
  WHERE claim.current_target_id = auth.uid()
    AND claim.placement = 'verse'
    AND claim.status IN ('pending', 'opened')
    AND challenge.status = 'active'
    AND challenge.item_type = 'mine'
    AND claim.reference_key IS NOT NULL
    AND (
      coalesce(cardinality(p_narrative_ids), 0) = 0
      OR EXISTS (
        SELECT 1
        FROM unnest(p_narrative_ids) narrative_id
        WHERE narrative_id::text = split_part(claim.reference_key, '|', 1)
      )
    )
  ORDER BY claim.created_at, claim.id;
$$;

CREATE OR REPLACE FUNCTION public.notify_scripture_mine_as_verse_tag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_challenge public.hidden_challenges%ROWTYPE;
  v_actor_name text;
  v_narrative_id text;
  v_verse_reference text;
BEGIN
  IF NEW.placement <> 'verse' OR NEW.reference_key IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT challenge.* INTO v_challenge
  FROM public.hidden_challenges challenge
  WHERE challenge.id = NEW.challenge_id;

  IF NOT FOUND OR v_challenge.item_type <> 'mine' THEN
    RETURN NEW;
  END IF;

  v_narrative_id := split_part(NEW.reference_key, '|', 1);
  v_verse_reference := split_part(NEW.reference_key, '|', 2);

  SELECT coalesce(nullif(btrim(profile.display_name), ''), 'A camp member')
  INTO v_actor_name
  FROM public.profiles profile
  WHERE profile.id = v_challenge.creator_id;

  PERFORM public.notify_user(
    NEW.current_target_id,
    v_challenge.creator_id,
    'scripture_insight_mention',
    'You were tagged in Today''s Reading',
    coalesce(v_actor_name, 'A camp member') || ' tagged you on ' || initcap(v_verse_reference) || '.',
    'narrative',
    jsonb_build_object(
      'hidden_challenge_claim_id', NEW.id,
      'hidden_item_type', 'mine',
      'placement', 'verse',
      'reference_key', NEW.reference_key,
      'narrative_id', v_narrative_id,
      'verse_reference', v_verse_reference
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_scripture_mine_as_verse_tag
  ON public.hidden_challenge_claims;
CREATE TRIGGER trg_notify_scripture_mine_as_verse_tag
AFTER INSERT ON public.hidden_challenge_claims
FOR EACH ROW
WHEN (NEW.placement = 'verse')
EXECUTE FUNCTION public.notify_scripture_mine_as_verse_tag();

/* Deliver the verse-tag notification for Mines hidden before this release. */
INSERT INTO public.user_notifications (
  recipient_id,
  actor_id,
  notification_type,
  title,
  body,
  action_key,
  metadata
)
SELECT
  claim.current_target_id,
  challenge.creator_id,
  'scripture_insight_mention',
  'You were tagged in Today''s Reading',
  coalesce(nullif(btrim(profile.display_name), ''), 'A camp member')
    || ' tagged you on ' || initcap(split_part(claim.reference_key, '|', 2)) || '.',
  'narrative',
  jsonb_build_object(
    'hidden_challenge_claim_id', claim.id,
    'hidden_item_type', 'mine',
    'placement', 'verse',
    'reference_key', claim.reference_key,
    'narrative_id', split_part(claim.reference_key, '|', 1),
    'verse_reference', split_part(claim.reference_key, '|', 2)
  )
FROM public.hidden_challenge_claims claim
JOIN public.hidden_challenges challenge ON challenge.id = claim.challenge_id
LEFT JOIN public.profiles profile ON profile.id = challenge.creator_id
WHERE claim.placement = 'verse'
  AND claim.reference_key IS NOT NULL
  AND claim.status IN ('pending', 'opened')
  AND challenge.status = 'active'
  AND challenge.item_type = 'mine'
  AND NOT EXISTS (
    SELECT 1
    FROM public.user_notifications notification
    WHERE notification.recipient_id = claim.current_target_id
      AND notification.metadata ->> 'hidden_challenge_claim_id' = claim.id::text
  );

REVOKE ALL ON FUNCTION public.enforce_hidden_challenge_fifteen_seconds()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_pending_hidden_verse_markers(uuid[])
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.notify_scripture_mine_as_verse_tag()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_my_pending_hidden_verse_markers(uuid[])
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notify_scripture_mine_as_verse_tag()
  TO service_role;
