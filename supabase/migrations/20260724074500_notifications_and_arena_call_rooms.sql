/*
# Notifications and arena call-room lifecycle

Adds a durable user notification feed and upgrades arena rooms so they behave
like hosted group calls: host-owned waiting rooms, invitations, host start/close,
and automatic expiry after six hours if nobody else joins.
*/

-- ============================================================
-- User notifications
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  notification_type text NOT NULL DEFAULT 'info',
  title text NOT NULL,
  body text NOT NULL,
  action_key text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_notifications_recipient_created
  ON public.user_notifications(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_notifications_unread
  ON public.user_notifications(recipient_id, read_at)
  WHERE read_at IS NULL;

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_user_notifications" ON public.user_notifications;
CREATE POLICY "select_own_user_notifications"
  ON public.user_notifications FOR SELECT TO authenticated
  USING (recipient_id = auth.uid());

DROP POLICY IF EXISTS "update_own_user_notifications" ON public.user_notifications;
CREATE POLICY "update_own_user_notifications"
  ON public.user_notifications FOR UPDATE TO authenticated
  USING (recipient_id = auth.uid())
  WITH CHECK (recipient_id = auth.uid());

CREATE OR REPLACE FUNCTION public.notify_user(
  p_recipient_id uuid,
  p_actor_id uuid,
  p_notification_type text,
  p_title text,
  p_body text,
  p_action_key text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_recipient_id IS NULL OR NULLIF(btrim(COALESCE(p_title, '')), '') IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.user_notifications (
    recipient_id,
    actor_id,
    notification_type,
    title,
    body,
    action_key,
    metadata
  )
  VALUES (
    p_recipient_id,
    p_actor_id,
    COALESCE(NULLIF(btrim(p_notification_type), ''), 'info'),
    btrim(p_title),
    COALESCE(NULLIF(btrim(p_body), ''), btrim(p_title)),
    NULLIF(btrim(COALESCE(p_action_key, '')), ''),
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT SELECT, UPDATE ON public.user_notifications TO authenticated;
GRANT EXECUTE ON FUNCTION public.notify_user(uuid, uuid, text, text, text, text, jsonb) TO authenticated;

-- ============================================================
-- Notification triggers for current interaction surfaces
-- ============================================================

CREATE OR REPLACE FUNCTION public.notify_denarii_ledger_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title text;
  v_body text;
  v_action text := 'dashboard';
BEGIN
  IF COALESCE(NEW.amount, 0) = 0 THEN
    RETURN NEW;
  END IF;

  IF NEW.source_type IN ('relic_purchase', 'freezer_daily', 'freezer_weekly') THEN
    v_action := 'store';
  ELSIF NEW.source_type IN ('arena_stake', 'arena_fee', 'arena_reward') THEN
    v_action := 'arena';
  ELSIF NEW.source_type IN ('quiz_reward', 'fortune_quiz_reward') THEN
    v_action := 'quiz';
  ELSIF NEW.source_type IN ('game_level', 'game_blitz') THEN
    v_action := 'game';
  END IF;

  IF NEW.amount > 0 THEN
    v_title := 'Denarii added';
    v_body := 'You received ' || NEW.amount::text || ' denarii'
      || CASE WHEN NEW.description IS NOT NULL THEN ': ' || NEW.description ELSE '.' END;
  ELSE
    v_title := 'Denarii spent';
    v_body := abs(NEW.amount)::text || ' denarii was spent'
      || CASE WHEN NEW.description IS NOT NULL THEN ': ' || NEW.description ELSE '.' END;
  END IF;

  PERFORM public.notify_user(
    NEW.user_id,
    NULL,
    'economy',
    v_title,
    v_body,
    v_action,
    jsonb_build_object(
      'ledger_id', NEW.id,
      'source_type', NEW.source_type,
      'source_reference', NEW.source_reference,
      'amount', NEW.amount
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_denarii_ledger_entry ON public.denarii_ledger_entries;
CREATE TRIGGER trg_notify_denarii_ledger_entry
  AFTER INSERT ON public.denarii_ledger_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_denarii_ledger_entry();

CREATE OR REPLACE FUNCTION public.notify_relic_inventory_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_relic_name text;
  v_delta integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_delta := COALESCE(NEW.quantity, 0);
  ELSE
    v_delta := COALESCE(NEW.quantity, 0) - COALESCE(OLD.quantity, 0);
  END IF;

  IF v_delta = 0 THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_relic_name FROM public.relic_types WHERE id = NEW.relic_type_id;

  IF v_delta > 0 THEN
    PERFORM public.notify_user(
      NEW.user_id,
      NULL,
      'purchase',
      'Relic added',
      COALESCE(v_relic_name, 'A relic') || ' was added to your inventory.',
      'store',
      jsonb_build_object('relic_type_id', NEW.relic_type_id, 'quantity_delta', v_delta)
    );
  ELSE
    PERFORM public.notify_user(
      NEW.user_id,
      NULL,
      'relic',
      'Relic used',
      COALESCE(v_relic_name, 'A relic') || ' was used.',
      CASE WHEN COALESCE(v_relic_name, '') ILIKE '%goliath%' THEN 'game' ELSE 'store' END,
      jsonb_build_object('relic_type_id', NEW.relic_type_id, 'quantity_delta', v_delta)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_relic_inventory_insert ON public.relic_inventory;
CREATE TRIGGER trg_notify_relic_inventory_insert
  AFTER INSERT ON public.relic_inventory
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_relic_inventory_change();

DROP TRIGGER IF EXISTS trg_notify_relic_inventory_update ON public.relic_inventory;
CREATE TRIGGER trg_notify_relic_inventory_update
  AFTER UPDATE OF quantity ON public.relic_inventory
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_relic_inventory_change();

CREATE OR REPLACE FUNCTION public.notify_tent_message_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender_name text;
BEGIN
  IF NEW.sender_id = NEW.recipient_id THEN
    RETURN NEW;
  END IF;

  SELECT display_name INTO v_sender_name FROM public.profiles WHERE id = NEW.sender_id;

  PERFORM public.notify_user(
    NEW.recipient_id,
    NEW.sender_id,
    'message',
    'New tent message',
    COALESCE(v_sender_name, 'Someone in your tent') || ': ' || left(NEW.body, 120),
    'tent',
    jsonb_build_object('message_id', NEW.id, 'tent_id', NEW.tent_id)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_tent_message_insert ON public.tent_messages;
CREATE TRIGGER trg_notify_tent_message_insert
  AFTER INSERT ON public.tent_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_tent_message_insert();

CREATE OR REPLACE FUNCTION public.notify_tent_reaction_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reactor_name text;
BEGIN
  IF NEW.reactor_user_id = NEW.target_user_id THEN
    RETURN NEW;
  END IF;

  SELECT display_name INTO v_reactor_name FROM public.profiles WHERE id = NEW.reactor_user_id;

  PERFORM public.notify_user(
    NEW.target_user_id,
    NEW.reactor_user_id,
    'social',
    'Tent reaction',
    COALESCE(v_reactor_name, 'A tent mate') || ' reacted to you.',
    'tent',
    jsonb_build_object(
      'reaction_id', NEW.id,
      'tent_id', NEW.tent_id,
      'reaction_type', NEW.reaction_type,
      'target_type', NEW.target_type
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_tent_reaction_insert ON public.tent_reactions;
CREATE TRIGGER trg_notify_tent_reaction_insert
  AFTER INSERT ON public.tent_reactions
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_tent_reaction_insert();

CREATE OR REPLACE FUNCTION public.notify_challenge_review_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('approved', 'rejected') AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.notify_user(
      NEW.user_id,
      NEW.reviewed_by,
      'challenge',
      CASE WHEN NEW.status = 'approved' THEN 'Challenge approved' ELSE 'Challenge needs work' END,
      CASE
        WHEN NEW.status = 'approved' THEN 'Your challenge proof was approved.'
        ELSE 'Your challenge proof was rejected' || CASE WHEN NEW.rejection_reason IS NOT NULL THEN ': ' || NEW.rejection_reason ELSE '.' END
      END,
      'narrative',
      jsonb_build_object('challenge_submission_id', NEW.id, 'narrative_date', NEW.narrative_date, 'status', NEW.status)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_challenge_review_update ON public.challenge_submissions;
CREATE TRIGGER trg_notify_challenge_review_update
  AFTER UPDATE OF status ON public.challenge_submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_challenge_review_update();

CREATE OR REPLACE FUNCTION public.notify_mobile_money_payment_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  v_status := lower(COALESCE(NEW.status, 'pending'));

  IF TG_OP = 'INSERT' THEN
    PERFORM public.notify_user(
      NEW.user_id,
      NULL,
      'payment',
      'Payment request submitted',
      'Your payment request for ' || COALESCE(NEW.relic_name, 'a relic') || ' was recorded.',
      'store',
      jsonb_build_object('payment_id', NEW.id, 'status', NEW.status, 'relic_slug', NEW.relic_slug)
    );
    RETURN NEW;
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.notify_user(
      NEW.user_id,
      NEW.confirmed_by,
      'payment',
      CASE
        WHEN v_status IN ('confirmed', 'successful', 'success') THEN 'Purchase confirmed'
        WHEN v_status IN ('rejected', 'failed', 'cancelled') THEN 'Payment needs attention'
        ELSE 'Payment updated'
      END,
      CASE
        WHEN v_status IN ('confirmed', 'successful', 'success') THEN COALESCE(NEW.relic_name, 'Your relic') || ' was confirmed.'
        WHEN v_status IN ('rejected', 'failed', 'cancelled') THEN 'Your payment for ' || COALESCE(NEW.relic_name, 'a relic') || ' was not completed'
          || CASE WHEN NEW.rejection_reason IS NOT NULL THEN ': ' || NEW.rejection_reason ELSE '.' END
        ELSE 'Your payment for ' || COALESCE(NEW.relic_name, 'a relic') || ' changed to ' || NEW.status || '.'
      END,
      'store',
      jsonb_build_object('payment_id', NEW.id, 'status', NEW.status, 'relic_slug', NEW.relic_slug)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_mobile_money_payment_insert ON public.mobile_money_payments;
CREATE TRIGGER trg_notify_mobile_money_payment_insert
  AFTER INSERT ON public.mobile_money_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_mobile_money_payment_change();

DROP TRIGGER IF EXISTS trg_notify_mobile_money_payment_update ON public.mobile_money_payments;
CREATE TRIGGER trg_notify_mobile_money_payment_update
  AFTER UPDATE OF status ON public.mobile_money_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_mobile_money_payment_change();

-- ============================================================
-- Arena invitations and room lifecycle
-- ============================================================

ALTER TABLE public.arena_rooms ADD COLUMN IF NOT EXISTS game_call_fee integer DEFAULT 10;
ALTER TABLE public.arena_rooms ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE public.arena_rooms ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE public.arena_rooms ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

UPDATE public.arena_rooms
SET expires_at = created_at + interval '6 hours'
WHERE status = 'waiting' AND expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_arena_rooms_status_created
  ON public.arena_rooms(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_arena_rooms_expires
  ON public.arena_rooms(status, expires_at)
  WHERE status = 'waiting';

CREATE TABLE IF NOT EXISTS public.arena_room_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.arena_rooms(id) ON DELETE CASCADE,
  inviter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invitee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  UNIQUE(room_id, invitee_id)
);

CREATE INDEX IF NOT EXISTS idx_arena_room_invites_invitee
  ON public.arena_room_invites(invitee_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_arena_room_invites_room
  ON public.arena_room_invites(room_id);

ALTER TABLE public.arena_room_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_related_arena_room_invites" ON public.arena_room_invites;
CREATE POLICY "select_related_arena_room_invites"
  ON public.arena_room_invites FOR SELECT TO authenticated
  USING (
    invitee_id = auth.uid()
    OR inviter_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.arena_rooms r
      WHERE r.id = room_id AND r.creator_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "update_own_arena_room_invites" ON public.arena_room_invites;
CREATE POLICY "update_own_arena_room_invites"
  ON public.arena_room_invites FOR UPDATE TO authenticated
  USING (invitee_id = auth.uid())
  WITH CHECK (invitee_id = auth.uid());

GRANT SELECT, UPDATE ON public.arena_room_invites TO authenticated;

CREATE OR REPLACE FUNCTION public.expire_stale_arena_rooms()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room record;
  v_participant record;
  v_refund integer;
  v_expired_count integer := 0;
BEGIN
  FOR v_room IN
    SELECT
      r.*,
      (SELECT count(*) FROM public.arena_participants ap WHERE ap.room_id = r.id) AS participant_count
    FROM public.arena_rooms r
    WHERE r.status = 'waiting'
      AND COALESCE(r.expires_at, r.created_at + interval '6 hours') <= now()
  LOOP
    IF v_room.participant_count <= 1 THEN
      UPDATE public.arena_rooms
      SET status = 'expired',
          closed_at = now(),
          completed_at = now()
      WHERE id = v_room.id AND status = 'waiting';

      IF FOUND THEN
        v_expired_count := v_expired_count + 1;

        UPDATE public.arena_room_invites
        SET status = 'expired', responded_at = now()
        WHERE room_id = v_room.id AND status = 'pending';

        FOR v_participant IN
          SELECT user_id FROM public.arena_participants WHERE room_id = v_room.id
        LOOP
          v_refund := COALESCE(v_room.stake_amount, 0)
            + CASE WHEN v_participant.user_id = v_room.creator_id THEN COALESCE(v_room.game_call_fee, 0) ELSE 0 END;

          IF v_refund > 0 AND NOT EXISTS (
            SELECT 1 FROM public.denarii_ledger_entries
            WHERE user_id = v_participant.user_id
              AND source_type = 'arena_reward'
              AND source_reference = v_room.id::text
              AND description LIKE 'Arena room expired refund%'
          ) THEN
            INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, source_reference, description)
            VALUES (v_participant.user_id, v_refund, 'arena_reward', v_room.id::text, 'Arena room expired refund for ' || v_room.room_name);
          END IF;

          PERFORM public.notify_user(
            v_participant.user_id,
            NULL,
            'arena',
            'Arena room expired',
            '"' || v_room.room_name || '" closed automatically after six hours with no other player.',
            'arena',
            jsonb_build_object('room_id', v_room.id, 'status', 'expired')
          );
        END LOOP;
      END IF;
    ELSE
      UPDATE public.arena_rooms SET expires_at = NULL WHERE id = v_room.id;
    END IF;
  END LOOP;

  RETURN v_expired_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_arena_room(
  p_creator_id uuid,
  p_room_name text,
  p_stake_amount integer,
  p_max_players integer DEFAULT 4,
  p_narrative_date text DEFAULT NULL,
  p_tagged_user_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_balance bigint;
  v_game_fee integer := 10;
  v_invitee uuid;
  v_invitees uuid[];
  v_creator_name text;
  v_room_name text := COALESCE(NULLIF(btrim(p_room_name), ''), 'Arena Room');
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_creator_id THEN
    RAISE EXCEPTION 'You can only create arena rooms for yourself.';
  END IF;

  PERFORM public.expire_stale_arena_rooms();

  IF p_stake_amount < 10 THEN
    RAISE EXCEPTION 'Arena stake must be at least 10 denarii.';
  END IF;

  p_max_players := LEAST(GREATEST(COALESCE(p_max_players, 4), 2), 8);

  SELECT public.get_user_denarii_total(p_creator_id) INTO v_balance;
  IF v_balance < (p_stake_amount + v_game_fee) THEN
    RAISE EXCEPTION 'Insufficient denarii. You need % (stake + 10 game fee) but have %.',
      (p_stake_amount + v_game_fee), v_balance;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT invitee), '{}'::uuid[]) INTO v_invitees
  FROM unnest(COALESCE(p_tagged_user_ids, '{}'::uuid[])) AS invitee
  WHERE invitee IS NOT NULL AND invitee <> p_creator_id;

  INSERT INTO public.arena_rooms (
    creator_id,
    room_name,
    stake_amount,
    max_players,
    narrative_date,
    tagged_user_ids,
    game_call_fee,
    status,
    expires_at
  )
  VALUES (
    p_creator_id,
    v_room_name,
    p_stake_amount,
    p_max_players,
    p_narrative_date,
    v_invitees,
    v_game_fee,
    'waiting',
    now() + interval '6 hours'
  )
  RETURNING id INTO v_id;

  INSERT INTO public.arena_participants (room_id, user_id, stake_paid)
  VALUES (v_id, p_creator_id, true)
  ON CONFLICT (room_id, user_id) DO NOTHING;

  INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, source_reference, description)
  VALUES (p_creator_id, -p_stake_amount, 'arena_stake', v_id::text, 'Arena stake for room ' || v_room_name);

  INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, source_reference, description)
  VALUES (p_creator_id, -v_game_fee, 'arena_fee', v_id::text, 'Arena game call fee for room ' || v_room_name);

  SELECT display_name INTO v_creator_name FROM public.profiles WHERE id = p_creator_id;

  PERFORM public.notify_user(
    p_creator_id,
    NULL,
    'arena',
    'Arena room created',
    '"' || v_room_name || '" is open. You are the host, and only you can close or start it.',
    'arena',
    jsonb_build_object('room_id', v_id, 'status', 'waiting', 'expires_at', now() + interval '6 hours')
  );

  FOREACH v_invitee IN ARRAY v_invitees
  LOOP
    INSERT INTO public.arena_room_invites (room_id, inviter_id, invitee_id, status)
    VALUES (v_id, p_creator_id, v_invitee, 'pending')
    ON CONFLICT (room_id, invitee_id) DO UPDATE
      SET inviter_id = EXCLUDED.inviter_id,
          status = 'pending',
          created_at = now(),
          responded_at = NULL;

    PERFORM public.notify_user(
      v_invitee,
      p_creator_id,
      'arena_invite',
      'Arena invite',
      COALESCE(v_creator_name, 'A cadet') || ' invited you to "' || v_room_name || '".',
      'arena',
      jsonb_build_object('room_id', v_id, 'inviter_id', p_creator_id, 'stake_amount', p_stake_amount)
    );
  END LOOP;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.invite_arena_players(
  p_room_id uuid,
  p_inviter_id uuid,
  p_invitee_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room public.arena_rooms%ROWTYPE;
  v_invitee uuid;
  v_invitees uuid[];
  v_invited_count integer := 0;
  v_inviter_name text;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_inviter_id THEN
    RAISE EXCEPTION 'You can only send arena invites as yourself.';
  END IF;

  PERFORM public.expire_stale_arena_rooms();

  SELECT * INTO v_room FROM public.arena_rooms WHERE id = p_room_id;
  IF NOT FOUND OR v_room.status <> 'waiting' THEN
    RAISE EXCEPTION 'Room is not accepting invites.';
  END IF;

  IF v_room.creator_id <> p_inviter_id THEN
    RAISE EXCEPTION 'Only the host can invite players to this room.';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT invitee), '{}'::uuid[]) INTO v_invitees
  FROM unnest(COALESCE(p_invitee_ids, '{}'::uuid[])) AS invitee
  WHERE invitee IS NOT NULL
    AND invitee <> p_inviter_id
    AND NOT EXISTS (
      SELECT 1 FROM public.arena_participants ap
      WHERE ap.room_id = p_room_id AND ap.user_id = invitee
    );

  SELECT display_name INTO v_inviter_name FROM public.profiles WHERE id = p_inviter_id;

  FOREACH v_invitee IN ARRAY v_invitees
  LOOP
    INSERT INTO public.arena_room_invites (room_id, inviter_id, invitee_id, status)
    VALUES (p_room_id, p_inviter_id, v_invitee, 'pending')
    ON CONFLICT (room_id, invitee_id) DO UPDATE
      SET inviter_id = EXCLUDED.inviter_id,
          status = 'pending',
          created_at = now(),
          responded_at = NULL;

    UPDATE public.arena_rooms
    SET tagged_user_ids = (
      SELECT COALESCE(array_agg(DISTINCT x), '{}'::uuid[])
      FROM unnest(COALESCE(tagged_user_ids, '{}'::uuid[]) || ARRAY[v_invitee]) AS x
    )
    WHERE id = p_room_id;

    PERFORM public.notify_user(
      v_invitee,
      p_inviter_id,
      'arena_invite',
      'Arena invite',
      COALESCE(v_inviter_name, 'A cadet') || ' invited you to "' || v_room.room_name || '".',
      'arena',
      jsonb_build_object('room_id', p_room_id, 'inviter_id', p_inviter_id, 'stake_amount', v_room.stake_amount)
    );

    v_invited_count := v_invited_count + 1;
  END LOOP;

  RETURN v_invited_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.join_arena_room(p_room_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room public.arena_rooms%ROWTYPE;
  v_balance bigint;
  v_count integer;
  v_joiner_name text;
  v_participant record;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'You can only join arena rooms as yourself.';
  END IF;

  PERFORM public.expire_stale_arena_rooms();

  SELECT * INTO v_room
  FROM public.arena_rooms
  WHERE id = p_room_id AND status = 'waiting'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room not found or not accepting players.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.arena_participants
    WHERE room_id = p_room_id AND user_id = p_user_id
  ) THEN
    UPDATE public.arena_room_invites
    SET status = 'accepted', responded_at = now()
    WHERE room_id = p_room_id AND invitee_id = p_user_id AND status = 'pending';
    RETURN;
  END IF;

  SELECT count(*) INTO v_count FROM public.arena_participants WHERE room_id = p_room_id;
  IF v_count >= v_room.max_players THEN
    RAISE EXCEPTION 'Room is full.';
  END IF;

  SELECT public.get_user_denarii_total(p_user_id) INTO v_balance;
  IF v_balance < v_room.stake_amount THEN
    RAISE EXCEPTION 'Insufficient denarii for stake. You need % but have %.', v_room.stake_amount, v_balance;
  END IF;

  INSERT INTO public.arena_participants (room_id, user_id, stake_paid)
  VALUES (p_room_id, p_user_id, true);

  INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, source_reference, description)
  VALUES (p_user_id, -v_room.stake_amount, 'arena_stake', p_room_id::text, 'Arena stake for room ' || v_room.room_name);

  UPDATE public.arena_room_invites
  SET status = 'accepted', responded_at = now()
  WHERE room_id = p_room_id AND invitee_id = p_user_id AND status = 'pending';

  SELECT display_name INTO v_joiner_name FROM public.profiles WHERE id = p_user_id;

  FOR v_participant IN
    SELECT user_id FROM public.arena_participants
    WHERE room_id = p_room_id AND user_id <> p_user_id
  LOOP
    PERFORM public.notify_user(
      v_participant.user_id,
      p_user_id,
      'arena',
      'Arena player joined',
      COALESCE(v_joiner_name, 'A cadet') || ' joined "' || v_room.room_name || '".',
      'arena',
      jsonb_build_object('room_id', p_room_id, 'joined_user_id', p_user_id)
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_arena_game(p_room_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room public.arena_rooms%ROWTYPE;
  v_count integer;
  v_participant record;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'You can only start arena rooms as yourself.';
  END IF;

  PERFORM public.expire_stale_arena_rooms();

  SELECT * INTO v_room FROM public.arena_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.status <> 'waiting' THEN
    RAISE EXCEPTION 'Room is not waiting.';
  END IF;
  IF v_room.creator_id <> p_user_id THEN
    RAISE EXCEPTION 'Only the host can start this room.';
  END IF;

  SELECT count(*) INTO v_count FROM public.arena_participants WHERE room_id = p_room_id;
  IF v_count < 2 THEN
    RAISE EXCEPTION 'At least two players are required to start.';
  END IF;

  UPDATE public.arena_rooms
  SET status = 'playing',
      started_at = now(),
      expires_at = NULL
  WHERE id = p_room_id;

  FOR v_participant IN
    SELECT user_id FROM public.arena_participants WHERE room_id = p_room_id
  LOOP
    PERFORM public.notify_user(
      v_participant.user_id,
      p_user_id,
      'arena',
      'Arena game started',
      '"' || v_room.room_name || '" has started.',
      'arena',
      jsonb_build_object('room_id', p_room_id, 'status', 'playing')
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_arena_room(p_room_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room public.arena_rooms%ROWTYPE;
  v_participant record;
  v_refund integer;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'You can only close arena rooms as yourself.';
  END IF;

  SELECT * INTO v_room FROM public.arena_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room not found.';
  END IF;
  IF v_room.creator_id <> p_user_id THEN
    RAISE EXCEPTION 'Only the host can close this room.';
  END IF;
  IF v_room.status <> 'waiting' THEN
    RAISE EXCEPTION 'Only waiting rooms can be closed.';
  END IF;

  UPDATE public.arena_rooms
  SET status = 'cancelled',
      closed_by = p_user_id,
      closed_at = now(),
      completed_at = now()
  WHERE id = p_room_id;

  UPDATE public.arena_room_invites
  SET status = 'cancelled', responded_at = now()
  WHERE room_id = p_room_id AND status = 'pending';

  FOR v_participant IN
    SELECT user_id FROM public.arena_participants WHERE room_id = p_room_id
  LOOP
    v_refund := COALESCE(v_room.stake_amount, 0)
      + CASE WHEN v_participant.user_id = v_room.creator_id THEN COALESCE(v_room.game_call_fee, 0) ELSE 0 END;

    IF v_refund > 0 AND NOT EXISTS (
      SELECT 1 FROM public.denarii_ledger_entries
      WHERE user_id = v_participant.user_id
        AND source_type = 'arena_reward'
        AND source_reference = p_room_id::text
        AND description LIKE 'Arena room cancelled refund%'
    ) THEN
      INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, source_reference, description)
      VALUES (v_participant.user_id, v_refund, 'arena_reward', p_room_id::text, 'Arena room cancelled refund for ' || v_room.room_name);
    END IF;

    PERFORM public.notify_user(
      v_participant.user_id,
      p_user_id,
      'arena',
      'Arena room closed',
      '"' || v_room.room_name || '" was closed by the host.',
      'arena',
      jsonb_build_object('room_id', p_room_id, 'status', 'cancelled')
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_arena_game(p_room_id uuid, p_user_id uuid, p_score integer, p_correct_count integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room public.arena_rooms%ROWTYPE;
  v_winner uuid;
  v_winner_name text;
  v_total_stake integer;
  v_count integer;
  v_participant record;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'You can only finish arena games as yourself.';
  END IF;

  SELECT * INTO v_room FROM public.arena_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.status <> 'playing' THEN
    RAISE EXCEPTION 'Arena game is not active.';
  END IF;

  UPDATE public.arena_participants
  SET score = p_score,
      correct_count = p_correct_count,
      finished_at = now()
  WHERE room_id = p_room_id AND user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You are not a participant in this arena room.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.arena_participants
    WHERE room_id = p_room_id AND finished_at IS NULL
  ) THEN
    SELECT user_id INTO v_winner
    FROM public.arena_participants
    WHERE room_id = p_room_id
    ORDER BY score DESC, correct_count DESC, finished_at ASC
    LIMIT 1;

    SELECT count(*) INTO v_count FROM public.arena_participants WHERE room_id = p_room_id;
    v_total_stake := COALESCE(v_room.stake_amount, 0) * v_count;

    IF v_winner IS NOT NULL AND v_total_stake > 0 THEN
      INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, source_reference, description)
      VALUES (v_winner, v_total_stake, 'arena_reward', p_room_id::text, 'Arena winner for room ' || v_room.room_name);
    END IF;

    SELECT display_name INTO v_winner_name FROM public.profiles WHERE id = v_winner;

    UPDATE public.arena_rooms
    SET status = 'completed',
        winner_id = v_winner,
        completed_at = now()
    WHERE id = p_room_id;

    FOR v_participant IN
      SELECT user_id FROM public.arena_participants WHERE room_id = p_room_id
    LOOP
      PERFORM public.notify_user(
        v_participant.user_id,
        v_winner,
        'arena',
        CASE WHEN v_participant.user_id = v_winner THEN 'You won the arena' ELSE 'Arena game finished' END,
        CASE
          WHEN v_participant.user_id = v_winner THEN 'You won "' || v_room.room_name || '" and received ' || v_total_stake::text || ' denarii.'
          ELSE COALESCE(v_winner_name, 'A cadet') || ' won "' || v_room.room_name || '".'
        END,
        'arena',
        jsonb_build_object('room_id', p_room_id, 'status', 'completed', 'winner_id', v_winner)
      );
    END LOOP;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.expire_stale_arena_rooms() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_arena_room(uuid, text, integer, integer, text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_arena_players(uuid, uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_arena_room(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_arena_game(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_arena_room(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finish_arena_game(uuid, uuid, integer, integer) TO authenticated;
