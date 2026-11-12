ALTER TABLE public.arena_scheduled_matches
  ADD COLUMN is_sentry_match boolean NOT NULL DEFAULT false;

CREATE FUNCTION public.schedule_sentry_arena_match(
  p_tent_id uuid, p_room_name text, p_game_type text, p_player_ids uuid[], p_starts_at timestamptz
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_sentry uuid := auth.uid();
  v_ids uuid[];
  v_room_id uuid;
  v_player_id uuid;
  v_name text;
  v_title text;
BEGIN
  IF v_sentry IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.role_assignments
    WHERE user_id = v_sentry AND role = 'sentry' AND status IN ('active', 'approved')
    FOR SHARE
  ) OR NOT EXISTS (
    SELECT 1 FROM public.tents WHERE id = p_tent_id AND sentry_id = v_sentry FOR SHARE
  ) THEN RAISE EXCEPTION 'You can only schedule matches for your own tent.'; END IF;

  IF p_game_type IS NULL OR p_game_type NOT IN ('standard', 'ludo') THEN
    RAISE EXCEPTION 'Choose an Arena game.';
  END IF;
  IF p_starts_at IS NULL OR p_starts_at < now() + interval '1 minute'
    OR p_starts_at > now() + interval '90 days' THEN
    RAISE EXCEPTION 'Choose a time between one minute and 90 days from now.';
  END IF;

  SELECT array_agg(id ORDER BY ordinal) INTO v_ids
  FROM (SELECT DISTINCT ON (id) id, ordinal
        FROM unnest(p_player_ids) WITH ORDINALITY AS chosen(id, ordinal)
        WHERE id IS NOT NULL ORDER BY id, ordinal) distinct_ids;
  IF coalesce(cardinality(v_ids), 0) NOT BETWEEN 2 AND 4 THEN
    RAISE EXCEPTION 'Choose 2 to 4 distinct cadets.';
  END IF;
  IF v_sentry = ANY(v_ids) OR (
    SELECT count(DISTINCT roster.user_id) FROM (
      SELECT member.user_id FROM public.tent_members member
      WHERE member.tent_id = p_tent_id AND member.role = 'cadet' AND member.user_id = ANY(v_ids)
      FOR SHARE
    ) roster
  ) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'Every player must be a cadet in your own tent.';
  END IF;

  v_title := left(coalesce(nullif(btrim(translate(p_room_name, '[]', '')), ''), 'Tent Match'), 72);
  v_name := v_title || ' [arena:' || p_game_type || ']';
  INSERT INTO public.arena_rooms (
    creator_id, room_name, stake_amount, max_players, status, tagged_user_ids, game_call_fee, expires_at
  ) VALUES (
    v_ids[1], v_name, 0, cardinality(v_ids), 'waiting', v_ids, 0, p_starts_at + interval '2 hours'
  ) RETURNING id INTO v_room_id;

  INSERT INTO public.arena_scheduled_matches(room_id, scheduled_by, starts_at, player_ids, is_sentry_match)
  VALUES (v_room_id, v_sentry, p_starts_at, v_ids, true);

  FOREACH v_player_id IN ARRAY v_ids LOOP
    PERFORM public.notify_user(v_player_id, v_sentry, 'arena', 'Tent Arena match',
      'Your sentry scheduled ' || v_title || '. Open the Arena waiting room before the match begins.',
      'arena', jsonb_build_object('room_id', v_room_id, 'starts_at', p_starts_at));
  END LOOP;
  RETURN v_room_id;
END;
$$;

REVOKE ALL ON FUNCTION public.schedule_sentry_arena_match(uuid,text,text,uuid[],timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.schedule_sentry_arena_match(uuid,text,text,uuid[],timestamptz) TO authenticated;

-- Sentry matches are single matches and use no instructor Denarii awards.
CREATE OR REPLACE TRIGGER register_scheduled_arena_series_after_insert
AFTER INSERT ON public.arena_scheduled_matches
FOR EACH ROW WHEN (NOT NEW.is_sentry_match)
EXECUTE FUNCTION public.register_scheduled_arena_series();

CREATE FUNCTION public.get_tent_cadet_positions(p_tent_id uuid)
RETURNS TABLE (user_id uuid, overall_position integer, weekly_position integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_viewer uuid := auth.uid();
  v_now timestamptz := statement_timestamp();
  v_week_start timestamptz := date_trunc('week', v_now AT TIME ZONE 'Africa/Douala') AT TIME ZONE 'Africa/Douala';
BEGIN
  IF v_viewer IS NULL OR NOT (
    public.is_instructor(v_viewer)
    OR EXISTS (SELECT 1 FROM public.tents WHERE id = p_tent_id AND sentry_id = v_viewer)
    OR EXISTS (SELECT 1 FROM public.tent_members member WHERE member.tent_id = p_tent_id AND member.user_id = v_viewer)
  ) THEN RAISE EXCEPTION 'You can only view positions for your own tent.'; END IF;

  RETURN QUERY
  WITH scores AS MATERIALIZED (
    SELECT member.user_id AS cadet_id, profile.display_name,
      coalesce(board.marks, 0) AS marks, coalesce(board.rhudes, 0) AS rhudes,
      coalesce(board.total_figs, 0) AS total_figs,
      greatest(0, public.get_user_lifetime_figs(member.user_id, v_now)
        - public.get_user_lifetime_figs(member.user_id, v_week_start)) AS weekly_figs
    FROM public.tent_members member
    JOIN public.profiles profile ON profile.id = member.user_id
    LEFT JOIN public.get_marks_board_live() board ON board.user_id = member.user_id
    WHERE member.tent_id = p_tent_id AND member.role = 'cadet'
  ), overall AS (
    SELECT scores.*, row_number() OVER (
      ORDER BY marks DESC, rhudes DESC, total_figs DESC, display_name ASC, cadet_id
    )::integer AS position
    FROM scores
  )
  SELECT cadet_id, position,
    row_number() OVER (ORDER BY weekly_figs DESC, position)::integer
  FROM overall ORDER BY position;
END;
$$;

REVOKE ALL ON FUNCTION public.get_tent_cadet_positions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tent_cadet_positions(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.settle_instructor_arena_match_awards()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_schedule public.arena_scheduled_matches%ROWTYPE;
  v_game public.arena_tournament_games%ROWTYPE;
  v_tournament public.arena_tournaments%ROWTYPE;
  v_next public.arena_tournament_games%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_house_id text;
  v_total integer;
  v_recipient record;
  v_match_name text;
  v_group integer;
  v_qualifiers uuid[];
  v_first_match integer;
  v_second_match integer;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  SELECT * INTO v_schedule FROM public.arena_scheduled_matches WHERE room_id = NEW.id;
  IF NOT FOUND OR v_schedule.is_sentry_match THEN RETURN NEW; END IF;

  IF NEW.status = 'playing' AND OLD.status = 'waiting' THEN
    INSERT INTO public.denarii_ledger_entries(user_id, amount, source_type, source_reference, description)
    SELECT participant.user_id, 1000, 'arena_reward', 'scheduled:play:' || NEW.id::text,
      'Instructor scheduled match participation: ' || NEW.room_name
    FROM public.arena_participants participant
    WHERE participant.room_id = NEW.id AND participant.forfeited_at IS NULL
      AND participant.user_id = ANY(v_schedule.player_ids)
      AND NEW.room_name NOT ILIKE '%[arena:prelude]%'
    ON CONFLICT DO NOTHING;
    UPDATE public.arena_tournaments SET status = 'playing'
    WHERE id = (SELECT game.tournament_id FROM public.arena_tournament_games game WHERE game.room_id = NEW.id)
      AND status = 'scheduled';
  END IF;

  IF NEW.status <> 'completed' OR OLD.status <> 'playing' THEN RETURN NEW; END IF;
  SELECT * INTO v_game FROM public.arena_tournament_games WHERE room_id = NEW.id;
  IF FOUND THEN
    SELECT * INTO v_tournament FROM public.arena_tournaments WHERE id = v_game.tournament_id FOR UPDATE;
  END IF;
  IF NEW.winner_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.arena_participants participant
    WHERE participant.room_id = NEW.id AND participant.user_id = NEW.winner_id
      AND NEW.winner_id = ANY(v_schedule.player_ids)
  ) THEN RETURN NEW; END IF;

  INSERT INTO public.denarii_ledger_entries(user_id, amount, source_type, source_reference, description)
  VALUES (NEW.winner_id, CASE WHEN NEW.room_name ILIKE '%[arena:prelude]%' THEN 1000 ELSE 5000 END, 'arena_reward', 'scheduled:win:' || NEW.id::text,
    'Instructor scheduled match winner: ' || NEW.room_name)
  ON CONFLICT DO NOTHING;
  v_total := CASE WHEN NEW.room_name ILIKE '%[arena:prelude]%' THEN 1000 ELSE 6000 END;

  IF v_game.id IS NOT NULL THEN
    UPDATE public.arena_tournament_games SET winner_id = NEW.winner_id WHERE id = v_game.id;
    IF v_game.round_number = 0 THEN
      v_group := v_game.group_number;
      IF NOT EXISTS (
        SELECT 1 FROM public.arena_tournament_games game
        WHERE game.tournament_id = v_tournament.id AND game.group_number = v_group
          AND game.winner_id IS NULL
      ) THEN
        SELECT array_agg(standing.id ORDER BY standing.wins DESC,
          standing.answers DESC, standing.points DESC, standing.seed)
        INTO v_qualifiers
        FROM (
          SELECT selected.id, selected.seed,
            (SELECT count(*) FROM public.arena_tournament_games game
              WHERE game.tournament_id = v_tournament.id AND game.group_number = v_group
                AND game.winner_id = selected.id) AS wins,
            (SELECT coalesce(sum(participant.correct_count), 0)
              FROM public.arena_tournament_games game
              JOIN public.arena_participants participant
                ON participant.room_id = game.room_id AND participant.user_id = selected.id
              WHERE game.tournament_id = v_tournament.id AND game.group_number = v_group) AS answers,
            (SELECT coalesce(sum(participant.score), 0)
              FROM public.arena_tournament_games game
              JOIN public.arena_participants participant
                ON participant.room_id = game.room_id AND participant.user_id = selected.id
              WHERE game.tournament_id = v_tournament.id AND game.group_number = v_group) AS points
          FROM unnest(v_tournament.player_ids) WITH ORDINALITY selected(id, seed)
          WHERE selected.seed BETWEEN (v_group - 1) * 4 + 1 AND v_group * 4
          ORDER BY wins DESC, answers DESC, points DESC, selected.seed
          LIMIT 2
        ) standing;
        v_first_match := ((v_group - 1) / 2) * 2 + 1;
        v_second_match := v_first_match + 1;
        IF v_group % 2 = 1 THEN
          UPDATE public.arena_tournament_games SET left_player_id = v_qualifiers[1]
          WHERE tournament_id = v_tournament.id AND round_number = 1 AND match_number = v_first_match;
          UPDATE public.arena_tournament_games SET right_player_id = v_qualifiers[2]
          WHERE tournament_id = v_tournament.id AND round_number = 1 AND match_number = v_second_match;
        ELSE
          UPDATE public.arena_tournament_games SET right_player_id = v_qualifiers[2]
          WHERE tournament_id = v_tournament.id AND round_number = 1 AND match_number = v_first_match;
          UPDATE public.arena_tournament_games SET left_player_id = v_qualifiers[1]
          WHERE tournament_id = v_tournament.id AND round_number = 1 AND match_number = v_second_match;
        END IF;
        FOR v_next IN SELECT * FROM public.arena_tournament_games game
          WHERE game.tournament_id = v_tournament.id AND game.round_number = 1
            AND game.match_number IN (v_first_match, v_second_match)
        LOOP
          IF v_next.left_player_id IS NOT NULL AND v_next.right_player_id IS NOT NULL
            AND v_next.room_id IS NULL THEN
            PERFORM public.create_arena_tournament_room(v_next.id);
          END IF;
        END LOOP;
      END IF;
    ELSIF v_game.round_number = v_tournament.knockout_rounds THEN
      INSERT INTO public.denarii_ledger_entries(user_id, amount, source_type, source_reference, description)
      VALUES (NEW.winner_id, 25000, 'arena_reward', 'scheduled:champion:' || v_tournament.id::text,
        'Arena tournament champion: ' || v_tournament.title)
      ON CONFLICT DO NOTHING;
      v_total := CASE WHEN NEW.room_name ILIKE '%[arena:prelude]%' THEN 26000 ELSE 31000 END;
      UPDATE public.arena_tournaments
      SET status = 'completed', champion_id = NEW.winner_id, completed_at = now()
      WHERE id = v_tournament.id;
    ELSE
      SELECT * INTO v_next FROM public.arena_tournament_games
      WHERE left_source_id = v_game.id OR right_source_id = v_game.id FOR UPDATE;
      IF FOUND THEN
        IF v_next.left_source_id = v_game.id THEN
          UPDATE public.arena_tournament_games SET left_player_id = NEW.winner_id WHERE id = v_next.id;
        ELSE
          UPDATE public.arena_tournament_games SET right_player_id = NEW.winner_id WHERE id = v_next.id;
        END IF;
        SELECT * INTO v_next FROM public.arena_tournament_games WHERE id = v_next.id;
        IF v_next.left_player_id IS NOT NULL AND v_next.right_player_id IS NOT NULL AND v_next.room_id IS NULL THEN
          PERFORM public.create_arena_tournament_room(v_next.id);
        END IF;
      END IF;
    END IF;
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = NEW.winner_id;
  SELECT tent.tent_house_id INTO v_house_id FROM public.tents tent
  WHERE tent.sentry_id = NEW.winner_id OR EXISTS (
    SELECT 1 FROM public.tent_members member WHERE member.tent_id = tent.id AND member.user_id = NEW.winner_id
  ) ORDER BY CASE WHEN tent.sentry_id = NEW.winner_id THEN 0 ELSE 1 END LIMIT 1;
  v_match_name := regexp_replace(NEW.room_name, '\s*\[arena:(standard|ludo)\]', '', 'gi');
  FOR v_recipient IN SELECT id FROM public.profiles LOOP
    PERFORM public.notify_user(v_recipient.id, NEW.winner_id, 'arena_scheduled_result',
      CASE WHEN v_total = 31000 THEN 'Tournament champion' ELSE 'Scheduled match result' END,
      coalesce(v_profile.display_name, 'A player') || ' won ' || v_total::text ||
        ' Denarii in ' || v_match_name || '.',
      'arena', jsonb_build_object(
        'room_id', NEW.id, 'tournament_id', v_game.tournament_id,
        'winner_id', NEW.winner_id, 'winner_name', v_profile.display_name,
        'winner_avatar_url', v_profile.avatar_url, 'winner_tent_house_id', v_house_id,
        'winner_amount', v_total));
  END LOOP;
  RETURN NEW;
END;
$function$;
