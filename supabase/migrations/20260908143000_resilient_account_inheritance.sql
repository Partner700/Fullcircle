/*
  Make duplicate-account deletion reliable against the schema as it exists
  today. The 27 July inheritance function referenced an award uniqueness rule
  that was later removed and could also collide on same-day streak snapshots.
  This replacement keeps the inheritance transaction atomic and conflict-safe.
*/

CREATE OR REPLACE FUNCTION public.release_account_deletion_references(
  p_account_id uuid
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reference record;
  v_changed integer := 0;
  v_total integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Account references can only be released by the account service.';
  END IF;

  FOR v_reference IN
    SELECT
      namespace.nspname AS schema_name,
      relation.relname AS table_name,
      attribute.attname AS column_name
    FROM pg_catalog.pg_constraint constraint_row
    JOIN pg_catalog.pg_class relation
      ON relation.oid = constraint_row.conrelid
    JOIN pg_catalog.pg_namespace namespace
      ON namespace.oid = relation.relnamespace
    JOIN pg_catalog.pg_attribute attribute
      ON attribute.attrelid = relation.oid
     AND attribute.attnum = constraint_row.conkey[1]
    WHERE constraint_row.contype = 'f'
      AND constraint_row.confrelid IN (
        'public.profiles'::regclass,
        'auth.users'::regclass
      )
      AND constraint_row.confdeltype IN ('a', 'r')
      AND array_length(constraint_row.conkey, 1) = 1
      AND NOT attribute.attnotnull
  LOOP
    EXECUTE format(
      'UPDATE %I.%I SET %I = NULL WHERE %I = $1',
      v_reference.schema_name,
      v_reference.table_name,
      v_reference.column_name,
      v_reference.column_name
    ) USING p_account_id;
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    v_total := v_total + v_changed;
  END LOOP;

  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.release_account_deletion_references(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_account_deletion_references(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.prepare_account_inheritance(
  p_account_id uuid,
  p_heir_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source public.profiles%ROWTYPE;
  v_heir public.profiles%ROWTYPE;
  v_source_role text;
  v_existing public.account_inheritances%ROWTYPE;
  v_inheritance_id uuid;
  v_balance bigint := 0;
  v_source_current integer := 0;
  v_source_longest integer := 0;
  v_heir_current integer := 0;
  v_heir_longest integer := 0;
  v_game_figs bigint := 0;
  v_quiz_figs numeric := 0;
  v_arena_figs bigint := 0;
  v_awards integer := 0;
  v_relics integer := 0;
  v_snapshot jsonb;
  v_award public.awards%ROWTYPE;
  v_award_target_id uuid;
  v_award_conflict_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Account inheritance can only be prepared by the account service.';
  END IF;

  IF p_account_id IS NULL OR p_heir_id IS NULL OR p_account_id = p_heir_id THEN
    RAISE EXCEPTION 'Choose a different active user as the heir.';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.account_inheritances inheritance
  WHERE inheritance.departing_user_id = p_account_id;

  IF FOUND THEN
    PERFORM public.release_account_deletion_references(p_account_id);
    RETURN jsonb_build_object(
      'inheritance_id', v_existing.id,
      'heir_id', v_existing.heir_user_id,
      'status', v_existing.status,
      'snapshot', v_existing.snapshot
    );
  END IF;

  /* Lock in UUID order so two simultaneous deletion requests cannot deadlock. */
  PERFORM profile.id
  FROM public.profiles profile
  WHERE profile.id IN (p_account_id, p_heir_id)
  ORDER BY profile.id
  FOR UPDATE;

  SELECT * INTO v_source
  FROM public.profiles profile
  WHERE profile.id = p_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The account to delete no longer exists.';
  END IF;

  SELECT * INTO v_heir
  FROM public.profiles profile
  WHERE profile.id = p_heir_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The nominated heir no longer exists.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.role_assignments assignment
    WHERE assignment.user_id = p_heir_id
      AND assignment.status IN ('active', 'approved')
  ) THEN
    RAISE EXCEPTION 'The nominated heir must have an active account.';
  END IF;

  SELECT assignment.role
  INTO v_source_role
  FROM public.role_assignments assignment
  WHERE assignment.user_id = p_account_id
    AND assignment.status IN ('active', 'approved')
  ORDER BY assignment.created_at DESC
  LIMIT 1;

  IF v_source_role = 'instructor' AND NOT EXISTS (
    SELECT 1
    FROM public.role_assignments assignment
    WHERE assignment.user_id = p_heir_id
      AND assignment.role = 'sentry'
      AND assignment.status IN ('active', 'approved')
  ) THEN
    RAISE EXCEPTION 'An instructor must nominate an active sentry as heir.';
  END IF;

  SELECT coalesce(sum(entry.amount), 0)
  INTO v_balance
  FROM public.denarii_ledger_entries entry
  WHERE entry.user_id = p_account_id;

  SELECT streak.current_streak, streak.longest_streak
  INTO v_source_current, v_source_longest
  FROM public.get_authoritative_streak(p_account_id) streak
  LIMIT 1;

  SELECT streak.current_streak, streak.longest_streak
  INTO v_heir_current, v_heir_longest
  FROM public.get_authoritative_streak(p_heir_id) streak
  LIMIT 1;

  SELECT coalesce(sum(attempt.score), 0)
  INTO v_game_figs
  FROM public.game_attempts attempt
  WHERE attempt.user_id = p_account_id;

  SELECT coalesce(sum(attempt.talents_scored), 0)
  INTO v_quiz_figs
  FROM public.quiz_attempts attempt
  WHERE attempt.user_id = p_account_id
    AND attempt.status IN ('submitted', 'timed_out');

  SELECT coalesce(sum(participant.score), 0)
  INTO v_arena_figs
  FROM public.arena_participants participant
  WHERE participant.user_id = p_account_id;

  SELECT count(*) INTO v_awards
  FROM public.awards award
  WHERE award.user_id = p_account_id;

  SELECT coalesce(sum(inventory.quantity), 0)
  INTO v_relics
  FROM public.relic_inventory inventory
  WHERE inventory.user_id = p_account_id;

  v_snapshot := jsonb_build_object(
    'denarii', v_balance,
    'current_streak', coalesce(v_source_current, 0),
    'longest_streak', coalesce(v_source_longest, 0),
    'game_figs', v_game_figs,
    'quiz_figs', v_quiz_figs,
    'arena_figs', v_arena_figs,
    'awards', v_awards,
    'relics', v_relics,
    'source_role', v_source_role
  );

  INSERT INTO public.account_inheritances (
    departing_user_id,
    departing_display_name,
    heir_user_id,
    snapshot
  ) VALUES (
    p_account_id,
    v_source.display_name,
    p_heir_id,
    v_snapshot
  )
  RETURNING id INTO v_inheritance_id;

  IF v_balance <> 0 THEN
    INSERT INTO public.denarii_ledger_entries (
      user_id, amount, source_type, source_reference, description
    ) VALUES (
      p_heir_id,
      v_balance::integer,
      'admin_adjustment',
      'inheritance:' || v_inheritance_id::text,
      'Inherited from ' || v_source.display_name
    );
  END IF;

  INSERT INTO public.relic_inventory AS inventory (
    user_id, relic_type_id, quantity, source_description
  )
  SELECT
    p_heir_id,
    source.relic_type_id,
    sum(source.quantity)::integer,
    'Inherited from ' || v_source.display_name
  FROM public.relic_inventory source
  WHERE source.user_id = p_account_id
  GROUP BY source.relic_type_id
  ON CONFLICT (user_id, relic_type_id) DO UPDATE
  SET quantity = inventory.quantity + EXCLUDED.quantity,
      source_description = EXCLUDED.source_description;

  DELETE FROM public.relic_inventory inventory
  WHERE inventory.user_id = p_account_id;

  /* Transfer awards against the current collective identity. A row-by-row
     merge avoids both the retired July key and a source row conflicting with
     itself when its target is independent of its representative account. */
  FOR v_award IN
    SELECT award.*
    FROM public.awards award
    WHERE award.user_id = p_account_id
    ORDER BY award.created_at, award.id
    FOR UPDATE
  LOOP
    v_award_target_id := CASE
      WHEN coalesce(v_award.award_target_type, 'cadet') <> 'tent'
        AND v_award.award_target_id = p_account_id THEN p_heir_id
      ELSE v_award.award_target_id
    END;
    v_award_conflict_id := NULL;

    SELECT existing.id
    INTO v_award_conflict_id
    FROM public.awards existing
    WHERE existing.id <> v_award.id
      AND existing.award_month = v_award.award_month
      AND coalesce(existing.award_target_type, 'cadet')
        = coalesce(v_award.award_target_type, 'cadet')
      AND coalesce(existing.award_target_id, existing.user_id)
        = coalesce(v_award_target_id, p_heir_id)
      AND existing.title = v_award.title
    LIMIT 1
    FOR UPDATE;

    IF v_award_conflict_id IS NULL THEN
      UPDATE public.awards award
      SET user_id = p_heir_id,
          award_target_id = v_award_target_id
      WHERE award.id = v_award.id;
    ELSE
      UPDATE public.awards award
      SET metric_value = greatest(
            coalesce(award.metric_value, 0),
            coalesce(v_award.metric_value, 0)
          ),
          description = coalesce(award.description, v_award.description)
      WHERE award.id = v_award_conflict_id;

      DELETE FROM public.awards award
      WHERE award.id = v_award.id;
    END IF;
  END LOOP;

  UPDATE public.daily_records record
  SET attendance_marked_by = NULL
  WHERE record.attendance_marked_by = p_account_id;

  UPDATE public.daily_records heir_record
  SET attendance_status = CASE
        WHEN heir_record.attendance_status = 'present' OR source_record.attendance_status = 'present'
          THEN 'present'
        WHEN heir_record.attendance_status = 'absent' OR source_record.attendance_status = 'absent'
          THEN 'absent'
        ELSE 'unmarked'
      END,
      attendance_marked_at = coalesce(heir_record.attendance_marked_at, source_record.attendance_marked_at),
      meditation_submitted = coalesce(heir_record.meditation_submitted, false)
        OR coalesce(source_record.meditation_submitted, false),
      meditation_submitted_at = coalesce(
        heir_record.meditation_submitted_at,
        source_record.meditation_submitted_at
      ),
      meditation_text = coalesce(nullif(heir_record.meditation_text, ''), source_record.meditation_text),
      quiz_attempt_id = coalesce(heir_record.quiz_attempt_id, source_record.quiz_attempt_id),
      streak_valid = coalesce(heir_record.streak_valid, false)
        OR coalesce(source_record.streak_valid, false),
      best_verse = coalesce(nullif(heir_record.best_verse, ''), source_record.best_verse),
      daily_quote = coalesce(nullif(heir_record.daily_quote, ''), source_record.daily_quote),
      attendance_late = coalesce(heir_record.attendance_late, false)
        AND coalesce(source_record.attendance_late, false),
      sunday_reading_opened_at = coalesce(
        heir_record.sunday_reading_opened_at,
        source_record.sunday_reading_opened_at
      ),
      meditation_public = coalesce(heir_record.meditation_public, false)
        OR coalesce(source_record.meditation_public, false)
  FROM public.daily_records source_record
  WHERE heir_record.user_id = p_heir_id
    AND source_record.user_id = p_account_id
    AND heir_record.record_date = source_record.record_date;

  DELETE FROM public.daily_records source_record
  WHERE source_record.user_id = p_account_id
    AND EXISTS (
      SELECT 1
      FROM public.daily_records heir_record
      WHERE heir_record.user_id = p_heir_id
        AND heir_record.record_date = source_record.record_date
    );

  UPDATE public.daily_records record
  SET user_id = p_heir_id
  WHERE record.user_id = p_account_id;

  UPDATE public.game_attempts attempt
  SET user_id = p_heir_id
  WHERE attempt.user_id = p_account_id;

  UPDATE public.quiz_attempts heir_attempt
  SET talents_scored = coalesce(heir_attempt.talents_scored, 0)
        + coalesce(source_attempt.talents_scored, 0),
      highest_question_reached = greatest(
        coalesce(heir_attempt.highest_question_reached, 0),
        coalesce(source_attempt.highest_question_reached, 0)
      ),
      relics_used = coalesce(heir_attempt.relics_used, '[]'::jsonb)
        || coalesce(source_attempt.relics_used, '[]'::jsonb),
      status = CASE
        WHEN heir_attempt.status IN ('submitted', 'timed_out') THEN heir_attempt.status
        WHEN source_attempt.status IN ('submitted', 'timed_out') THEN source_attempt.status
        WHEN heir_attempt.status = 'in_progress' OR source_attempt.status = 'in_progress' THEN 'in_progress'
        WHEN heir_attempt.status = 'forfeited' OR source_attempt.status = 'forfeited' THEN 'forfeited'
        ELSE heir_attempt.status
      END,
      submitted_at = greatest(heir_attempt.submitted_at, source_attempt.submitted_at),
      forfeited_at = greatest(heir_attempt.forfeited_at, source_attempt.forfeited_at)
  FROM public.quiz_attempts source_attempt
  WHERE heir_attempt.user_id = p_heir_id
    AND source_attempt.user_id = p_account_id
    AND heir_attempt.quiz_session_id = source_attempt.quiz_session_id;

  UPDATE public.daily_records daily
  SET quiz_attempt_id = heir_attempt.id
  FROM public.quiz_attempts source_attempt
  JOIN public.quiz_attempts heir_attempt
    ON heir_attempt.user_id = p_heir_id
   AND heir_attempt.quiz_session_id = source_attempt.quiz_session_id
  WHERE source_attempt.user_id = p_account_id
    AND daily.quiz_attempt_id = source_attempt.id;

  DELETE FROM public.quiz_attempts source_attempt
  WHERE source_attempt.user_id = p_account_id
    AND EXISTS (
      SELECT 1
      FROM public.quiz_attempts heir_attempt
      WHERE heir_attempt.user_id = p_heir_id
        AND heir_attempt.quiz_session_id = source_attempt.quiz_session_id
    );

  UPDATE public.quiz_attempts attempt
  SET user_id = p_heir_id
  WHERE attempt.user_id = p_account_id;

  UPDATE public.weekly_quiz_result_releases release
  SET user_id = p_heir_id
  WHERE release.user_id = p_account_id;

  UPDATE public.relic_usage_log usage
  SET user_id = p_heir_id
  WHERE usage.user_id = p_account_id;

  UPDATE public.arena_participants heir_participant
  SET score = heir_participant.score + source_participant.score,
      correct_count = heir_participant.correct_count + source_participant.correct_count,
      stake_paid = heir_participant.stake_paid OR source_participant.stake_paid,
      finished_at = greatest(heir_participant.finished_at, source_participant.finished_at)
  FROM public.arena_participants source_participant
  WHERE heir_participant.user_id = p_heir_id
    AND source_participant.user_id = p_account_id
    AND heir_participant.room_id = source_participant.room_id;

  DELETE FROM public.arena_participants source_participant
  WHERE source_participant.user_id = p_account_id
    AND EXISTS (
      SELECT 1
      FROM public.arena_participants heir_participant
      WHERE heir_participant.user_id = p_heir_id
        AND heir_participant.room_id = source_participant.room_id
    );

  UPDATE public.arena_participants participant
  SET user_id = p_heir_id
  WHERE participant.user_id = p_account_id;

  UPDATE public.arena_rooms room
  SET creator_id = CASE WHEN room.creator_id = p_account_id THEN p_heir_id ELSE room.creator_id END,
      winner_id = CASE WHEN room.winner_id = p_account_id THEN p_heir_id ELSE room.winner_id END,
      closed_by = CASE WHEN room.closed_by = p_account_id THEN p_heir_id ELSE room.closed_by END,
      tagged_user_ids = array_replace(room.tagged_user_ids, p_account_id, p_heir_id)
  WHERE room.creator_id = p_account_id
    OR room.winner_id = p_account_id
    OR room.closed_by = p_account_id
    OR p_account_id = ANY(coalesce(room.tagged_user_ids, '{}'::uuid[]));

  DELETE FROM public.arena_room_invites source_invite
  WHERE source_invite.invitee_id = p_account_id
    AND EXISTS (
      SELECT 1
      FROM public.arena_room_invites heir_invite
      WHERE heir_invite.room_id = source_invite.room_id
        AND heir_invite.invitee_id = p_heir_id
    );

  UPDATE public.arena_room_invites invite
  SET invitee_id = CASE WHEN invite.invitee_id = p_account_id THEN p_heir_id ELSE invite.invitee_id END,
      inviter_id = CASE WHEN invite.inviter_id = p_account_id THEN p_heir_id ELSE invite.inviter_id END
  WHERE invite.invitee_id = p_account_id OR invite.inviter_id = p_account_id;

  /* One-time Founder's Gift rows have a partial unique key. */
  DELETE FROM public.streak_freezers source
  WHERE source.user_id = p_account_id
    AND source.source = 'founders_gift'
    AND EXISTS (
      SELECT 1
      FROM public.streak_freezers heir
      WHERE heir.user_id = p_heir_id
        AND heir.source = source.source
        AND heir.applied_to_date = source.applied_to_date
    );

  UPDATE public.streak_freezers freezer
  SET user_id = p_heir_id
  WHERE freezer.user_id = p_account_id;

  UPDATE public.streakboard_snapshots heir_snapshot
  SET current_streak = greatest(heir_snapshot.current_streak, source_snapshot.current_streak),
      longest_streak = greatest(
        heir_snapshot.longest_streak,
        source_snapshot.longest_streak,
        heir_snapshot.current_streak,
        source_snapshot.current_streak
      ),
      volume = greatest(coalesce(heir_snapshot.volume, 0), coalesce(source_snapshot.volume, 0)),
      consistency = greatest(
        coalesce(heir_snapshot.consistency, 0),
        coalesce(source_snapshot.consistency, 0)
      ),
      improvement = greatest(
        coalesce(heir_snapshot.improvement, 0),
        coalesce(source_snapshot.improvement, 0)
      )
  FROM public.streakboard_snapshots source_snapshot
  WHERE heir_snapshot.user_id = p_heir_id
    AND source_snapshot.user_id = p_account_id
    AND heir_snapshot.snapshot_date = source_snapshot.snapshot_date;

  DELETE FROM public.streakboard_snapshots source_snapshot
  WHERE source_snapshot.user_id = p_account_id
    AND EXISTS (
      SELECT 1
      FROM public.streakboard_snapshots heir_snapshot
      WHERE heir_snapshot.user_id = p_heir_id
        AND heir_snapshot.snapshot_date = source_snapshot.snapshot_date
    );

  UPDATE public.streakboard_snapshots snapshot
  SET user_id = p_heir_id
  WHERE snapshot.user_id = p_account_id;

  UPDATE public.leaderboard_weekly_snapshots snapshot
  SET user_id = p_heir_id
  WHERE snapshot.user_id = p_account_id;

  UPDATE public.denarii_purchases purchase
  SET user_id = p_heir_id
  WHERE purchase.user_id = p_account_id;

  UPDATE public.challenge_submissions heir_submission
  SET status = CASE
        WHEN source_submission.status = 'approved' THEN 'approved'
        ELSE heir_submission.status
      END,
      proof_text = coalesce(nullif(heir_submission.proof_text, ''), source_submission.proof_text)
  FROM public.challenge_submissions source_submission
  WHERE heir_submission.user_id = p_heir_id
    AND source_submission.user_id = p_account_id
    AND heir_submission.narrative_date = source_submission.narrative_date
    AND heir_submission.status IN ('pending', 'approved')
    AND source_submission.status IN ('pending', 'approved');

  UPDATE public.challenge_submissions source_submission
  SET status = 'rejected',
      rejection_reason = coalesce(
        source_submission.rejection_reason,
        'Merged into the nominated heir account.'
      )
  WHERE source_submission.user_id = p_account_id
    AND source_submission.status IN ('pending', 'approved')
    AND EXISTS (
      SELECT 1
      FROM public.challenge_submissions heir_submission
      WHERE heir_submission.user_id = p_heir_id
        AND heir_submission.narrative_date = source_submission.narrative_date
        AND heir_submission.status IN ('pending', 'approved')
    );

  UPDATE public.challenge_submissions submission
  SET user_id = p_heir_id
  WHERE submission.user_id = p_account_id;

  INSERT INTO public.streak_achievement_days AS achievement (
    user_id, achievement_date, source_kind, recorded_at, last_confirmed_at
  )
  SELECT
    p_heir_id,
    source.achievement_date,
    source.source_kind,
    source.recorded_at,
    source.last_confirmed_at
  FROM public.streak_achievement_days source
  WHERE source.user_id = p_account_id
  ON CONFLICT (user_id, achievement_date) DO UPDATE
      SET source_kind = CASE
        WHEN achievement.source_kind = 'earned' OR EXCLUDED.source_kind = 'earned' THEN 'earned'
        ELSE 'restored'
      END,
      recorded_at = least(achievement.recorded_at, EXCLUDED.recorded_at),
      last_confirmed_at = greatest(achievement.last_confirmed_at, EXCLUDED.last_confirmed_at);

  DELETE FROM public.streak_achievement_days achievement
  WHERE achievement.user_id = p_account_id;

  INSERT INTO public.streak_achievement_verified_restorations AS restoration (
    user_id, achievement_date, evidence_reference, verified_by, verified_at
  )
  SELECT
    p_heir_id,
    source.achievement_date,
    source.evidence_reference,
    source.verified_by,
    source.verified_at
  FROM public.streak_achievement_verified_restorations source
  WHERE source.user_id = p_account_id
  ON CONFLICT (user_id, achievement_date) DO UPDATE
  SET evidence_reference = EXCLUDED.evidence_reference,
      verified_by = coalesce(restoration.verified_by, EXCLUDED.verified_by),
      verified_at = greatest(restoration.verified_at, EXCLUDED.verified_at);

  DELETE FROM public.streak_achievement_verified_restorations restoration
  WHERE restoration.user_id = p_account_id;

  INSERT INTO public.streak_achievement_baselines AS baseline (
    user_id, effective_date, minimum_qualifying_days, source_kind, source_reference, updated_at
  )
  SELECT
    p_heir_id,
    source.effective_date,
    source.minimum_qualifying_days,
    source.source_kind,
    'inheritance:' || v_inheritance_id::text,
    now()
  FROM public.streak_achievement_baselines source
  WHERE source.user_id = p_account_id
  ON CONFLICT (user_id) DO UPDATE
  SET effective_date = greatest(baseline.effective_date, EXCLUDED.effective_date),
      minimum_qualifying_days = greatest(
        baseline.minimum_qualifying_days,
        EXCLUDED.minimum_qualifying_days
      ),
      source_reference = EXCLUDED.source_reference,
      updated_at = now();

  DELETE FROM public.streak_achievement_baselines baseline
  WHERE baseline.user_id = p_account_id;

  IF EXISTS (SELECT 1 FROM public.subscriptions subscription WHERE subscription.user_id = p_heir_id) THEN
    UPDATE public.subscriptions heir_subscription
    SET status = CASE
          WHEN heir_subscription.status = 'active' OR source_subscription.status = 'active' THEN 'active'
          WHEN heir_subscription.status = 'trial' OR source_subscription.status = 'trial' THEN 'trial'
          ELSE heir_subscription.status
        END,
        trial_started_at = least(heir_subscription.trial_started_at, source_subscription.trial_started_at),
        trial_ends_at = greatest(heir_subscription.trial_ends_at, source_subscription.trial_ends_at),
        current_period_end = greatest(
          heir_subscription.current_period_end,
          source_subscription.current_period_end
        ),
        updated_at = now()
    FROM public.subscriptions source_subscription
    WHERE heir_subscription.user_id = p_heir_id
      AND source_subscription.user_id = p_account_id;

    DELETE FROM public.subscriptions subscription
    WHERE subscription.user_id = p_account_id;
  ELSE
    UPDATE public.subscriptions subscription
    SET user_id = p_heir_id
    WHERE subscription.user_id = p_account_id;
  END IF;

  /* Preserve tent membership when the kept account is not already assigned. */
  IF EXISTS (SELECT 1 FROM public.tent_members member WHERE member.user_id = p_heir_id) THEN
    DELETE FROM public.tent_members member WHERE member.user_id = p_account_id;
  ELSE
    UPDATE public.tent_members member
    SET user_id = p_heir_id
    WHERE member.user_id = p_account_id;
  END IF;

  IF v_source_role = 'instructor' THEN
    PERFORM public.promote_to_instructor(p_heir_id, p_account_id);
  END IF;

  /* The stronger live chain survives the merge, but the two chains are never
     added together. This is an explicit current-day recovery anchor. */
  IF coalesce(v_source_current, 0) > coalesce(v_heir_current, 0) THEN
    INSERT INTO public.streak_manual_adjustments AS adjustment (
      user_id, effective_date, current_streak, longest_streak, reason, created_at
    ) VALUES (
      p_heir_id,
      timezone('Africa/Douala', now())::date,
      v_source_current,
      greatest(v_source_longest, v_heir_longest, v_source_current, v_heir_current),
      'Preserved the stronger streak while deleting duplicate account ' || p_account_id::text,
      now()
    )
    ON CONFLICT (user_id) DO UPDATE
    SET effective_date = EXCLUDED.effective_date,
        current_streak = greatest(adjustment.current_streak, EXCLUDED.current_streak),
        longest_streak = greatest(
          adjustment.longest_streak,
          adjustment.current_streak,
          EXCLUDED.longest_streak,
          EXCLUDED.current_streak
        ),
        reason = EXCLUDED.reason,
        created_at = now();
  END IF;

  UPDATE public.streak_forward_baselines baseline
  SET longest_streak = greatest(
        baseline.longest_streak,
        coalesce(v_source_longest, 0),
        coalesce(v_heir_longest, 0)
      )
  WHERE baseline.user_id = p_heir_id;

  /* Detach every nullable NO ACTION profile reference, including columns
     introduced after the original inheritance function was written. */
  PERFORM public.release_account_deletion_references(p_account_id);

  PERFORM public.refresh_user_streak_snapshot(p_heir_id);

  PERFORM public.notify_user(
    p_heir_id,
    p_account_id,
    'account_inheritance',
    'Account inheritance received',
    'You inherited the game resources of ' || v_source.display_name || '.',
    'settings',
    jsonb_build_object('inheritance_id', v_inheritance_id)
  );

  RETURN jsonb_build_object(
    'inheritance_id', v_inheritance_id,
    'heir_id', p_heir_id,
    'status', 'prepared',
    'snapshot', v_snapshot
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_account_inheritance(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_account_inheritance(uuid, uuid)
  TO service_role;
