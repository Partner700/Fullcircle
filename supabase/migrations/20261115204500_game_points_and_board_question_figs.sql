-- Historical matches keep their recorded scores as the Fig fallback.
ALTER TABLE public.arena_participants ADD COLUMN IF NOT EXISTS figs_earned integer
  CHECK (figs_earned >= 0);

CREATE OR REPLACE FUNCTION public.get_game_points(p_game text DEFAULT NULL, p_players uuid[] DEFAULT '{}')
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH wins AS (
    SELECT DISTINCT a.user_id, 'daily_game' AS game, a.narrative_date::text || ':' || a.level AS result_id,
      CASE WHEN a.level <= 2 THEN 3 WHEN a.level <= 5 THEN 5 ELSE 7 END AS points
    FROM public.game_attempts a
    WHERE a.status = 'passed' AND a.mode <> 'practice'
    UNION ALL
    SELECT DISTINCT p.user_id, 'puzzle_trivia', p.difficulty || ':' || p.level,
      CASE p.difficulty WHEN 'easy' THEN 3 WHEN 'hard' THEN 7 ELSE 5 END
    FROM scripture_games.puzzle_runs p WHERE p.completed_at IS NOT NULL
    UNION ALL
    SELECT DISTINCT s.user_id, 'story_mode', s.level_slug, 5
    FROM public.story_mode_attempts s WHERE s.status = 'completed'
    UNION ALL
    SELECT CASE WHEN leg.room_id IS NULL THEN r.winner_id ELSE leg.leg_winner_id END,
      CASE
        WHEN prelude.room_id IS NOT NULL THEN 'prelude'
        WHEN journey.room_id IS NOT NULL THEN 'journey'
        WHEN ludo.room_id IS NOT NULL THEN 'ludo'
        ELSE 'standard'
      END,
      r.id::text,
      CASE
        WHEN r.play_mode IS DISTINCT FROM 'machine' THEN 10
        WHEN prelude.difficulty = 'easy' THEN 3
        WHEN prelude.difficulty = 'hard' THEN 7
        WHEN r.room_name ILIKE '%[difficulty:easy]%' THEN 3
        WHEN r.room_name ILIKE '%[difficulty:hard]%' THEN 7
        ELSE 5
      END
    FROM public.arena_rooms r
    LEFT JOIN public.arena_match_series_rounds leg ON leg.room_id = r.id
    LEFT JOIN scripture_games.prelude_games prelude ON prelude.room_id = r.id
    LEFT JOIN public.arena_journey_games journey ON journey.room_id = r.id
    LEFT JOIN public.arena_ludo_games ludo ON ludo.room_id = r.id
    WHERE r.status = 'completed' AND (r.winner_id IS NOT NULL OR leg.leg_winner_id IS NOT NULL)
  ), totals AS (
    SELECT user_id, game, sum(points) AS points
    FROM wins WHERE user_id IS NOT NULL
    GROUP BY GROUPING SETS ((user_id, game), (user_id))
  ), leaders AS (
    SELECT p.id AS user_id, p.display_name, p.avatar_url, p.player_number, t.points
    FROM totals t JOIN public.profiles p ON p.id = t.user_id
    WHERE t.game IS NOT DISTINCT FROM p_game
    ORDER BY t.points DESC, p.id
    LIMIT (CASE WHEN p_game IS NULL THEN 3 ELSE 1 END)
  )
  SELECT CASE WHEN auth.uid() IS NOT NULL THEN jsonb_build_object(
    'leaders', coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.points DESC, l.user_id) FROM leaders l), '[]'::jsonb),
    'totals', coalesce((SELECT jsonb_object_agg(t.user_id, t.points) FROM totals t
                        WHERE t.game IS NOT DISTINCT FROM p_game AND t.user_id = ANY(p_players[1:12])), '{}'::jsonb)
  ) END;
$$;

CREATE OR REPLACE FUNCTION public.settle_road_home_arena(
  p_room_id uuid,
  p_winner_id uuid,
  p_results jsonb,
  p_completion_reason text DEFAULT 'finished'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room public.arena_rooms%ROWTYPE;
  v_result jsonb;
  v_real_players integer;
  v_reward integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Road Home settlement is server-only.';
  END IF;
  SELECT * INTO v_room FROM public.arena_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.room_name !~* '\[arena:ludo\]' THEN
    RAISE EXCEPTION 'Road Home room not found.';
  END IF;
  IF v_room.status = 'completed' THEN
    RETURN jsonb_build_object('success', true, 'already_settled', true, 'winner_id', v_room.winner_id);
  END IF;
  IF p_winner_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.arena_participants participant
    WHERE participant.room_id = p_room_id AND participant.user_id = p_winner_id
  ) THEN RAISE EXCEPTION 'Winner is not a room participant.'; END IF;

  FOR v_result IN SELECT value FROM jsonb_array_elements(coalesce(p_results, '[]'::jsonb))
  LOOP
    UPDATE public.arena_participants
    SET score = greatest(0, coalesce((v_result->>'score')::integer, 0)),
        figs_earned = CASE WHEN v_result->>'figs_earned' IS NOT NULL THEN greatest(0,(v_result->>'figs_earned')::integer) ELSE figs_earned END,
        correct_count = greatest(0, coalesce((v_result->>'correct_count')::integer, 0)),
        finished_at = now()
    WHERE room_id = p_room_id AND user_id = (v_result->>'user_id')::uuid;
  END LOOP;

  SELECT count(*) INTO v_real_players
  FROM public.arena_participants WHERE room_id = p_room_id;
  v_reward := greatest(coalesce(v_room.stake_amount, 0), 0) * greatest(v_real_players, 1) * 10;
  IF p_winner_id IS NOT NULL AND v_reward > 0 AND NOT EXISTS (
    SELECT 1 FROM public.denarii_ledger_entries entry
    WHERE entry.user_id = p_winner_id
      AND entry.source_type = 'arena_reward'
      AND entry.source_reference = p_room_id::text
      AND entry.description LIKE 'Road Home%'
  ) THEN
    INSERT INTO public.denarii_ledger_entries(user_id, amount, source_type, source_reference, description)
    VALUES (p_winner_id, v_reward, 'arena_reward', p_room_id::text,
      'Road Home tenfold winner reward for ' || v_room.room_name);
  END IF;

  UPDATE public.arena_rooms
  SET status = 'completed', winner_id = p_winner_id, completed_at = now(),
      completion_reason = CASE WHEN p_completion_reason = 'forfeit' THEN 'forfeit' ELSE 'finished' END
  WHERE id = p_room_id;
  RETURN jsonb_build_object('success', true, 'winner_id', p_winner_id, 'reward', CASE WHEN p_winner_id IS NULL THEN 0 ELSE v_reward END);
END;
$$;

CREATE OR REPLACE FUNCTION journey_private.sync_journey_points()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_player jsonb;
BEGIN
  IF TG_TABLE_NAME = 'arena_participants' THEN
    SELECT player INTO v_player FROM public.arena_journey_games game,
      jsonb_array_elements(game.state->'game'->'players') player
    WHERE game.room_id = NEW.room_id AND player->>'id' = NEW.user_id::text;
    IF v_player ? 'questionFigs' THEN NEW.figs_earned := greatest(0,(v_player->>'questionFigs')::integer); END IF;
    IF v_player ? 'score' THEN NEW.score := (v_player->>'score')::integer; END IF;
  ELSE
    SELECT player INTO v_player FROM public.arena_journey_games game,
      jsonb_array_elements(game.state->'game'->'players') player
    WHERE game.room_id = NEW.id AND player->>'id' = '00000000-0000-0000-0000-000000000000';
    IF v_player ? 'score' THEN NEW.machine_score := (v_player->>'score')::integer; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_lifetime_figs(p_user_id uuid, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH quiz_attempt_figs AS (
    SELECT
      attempt.id,
      attempt.user_id,
      attempt.submitted_at,
      coalesce(
        attempt.talents_scored::numeric,
        sum(
          CASE
            WHEN public.quiz_answer_is_correct(response.answer, question.question_payload)
              AND NOT coalesce(response.assisted_by_relic, false)
            THEN CASE
              WHEN question.difficulty_tag = 'hard' THEN 5
              WHEN question.difficulty_tag IN ('moderate', 'medium') THEN 3
              ELSE 1
            END
            ELSE 0
          END
        )::numeric,
        0
      ) AS figs
    FROM public.quiz_attempts attempt
    LEFT JOIN public.question_responses response
      ON response.quiz_attempt_id = attempt.id
    LEFT JOIN public.generated_questions question
      ON question.id = response.question_id
    WHERE attempt.user_id = p_user_id
      AND attempt.status IN ('submitted', 'timed_out')
      AND (p_before IS NULL OR attempt.submitted_at < p_before)
    GROUP BY attempt.id, attempt.user_id, attempt.submitted_at, attempt.talents_scored
  ), fig_sources AS (
    SELECT coalesce(sum(attempt.score), 0)::numeric AS figs
    FROM public.game_attempts attempt
    WHERE attempt.user_id = p_user_id
      AND attempt.completed_at IS NOT NULL
      AND attempt.status IN ('passed', 'failed')
      AND (p_before IS NULL OR attempt.completed_at < p_before)

    UNION ALL

    SELECT coalesce(sum(coalesce(participant.figs_earned,participant.score)), 0)::numeric
    FROM public.arena_participants participant
    JOIN public.arena_rooms room ON room.id = participant.room_id
    WHERE participant.user_id = p_user_id
      AND participant.finished_at IS NOT NULL
      AND room.status = 'completed'
      AND (p_before IS NULL OR participant.finished_at < p_before)
      AND (p_before IS NULL OR room.completed_at < p_before)

    UNION ALL

    SELECT coalesce(sum(quiz.figs), 0)::numeric
    FROM quiz_attempt_figs quiz

    UNION ALL

    SELECT coalesce(sum(story.figs), 0)::numeric
    FROM public.story_mode_fig_entries story
    WHERE story.user_id = p_user_id
      AND (p_before IS NULL OR story.earned_at < p_before)

    UNION ALL

    SELECT coalesce(sum(adjustment.amount), 0)::numeric
    FROM public.account_fig_adjustments adjustment
    WHERE adjustment.user_id = p_user_id
      AND (p_before IS NULL OR adjustment.effective_at < p_before)
    UNION ALL
    SELECT coalesce(sum(entry.amount),0)::numeric
    FROM scripture_games.fig_entries entry WHERE entry.user_id=p_user_id
      AND (p_before IS NULL OR entry.earned_at<p_before)
  )
  SELECT coalesce(sum(source.figs), 0)::numeric
  FROM fig_sources source;
$function$;

CREATE OR REPLACE FUNCTION public.get_monthly_award_nominees(p_month date DEFAULT NULL::date)
 RETURNS TABLE(award_title text, target_type text, target_id uuid, display_name text, avatar_url text, metric_value numeric, detail text, rank bigint, is_leader boolean, needs_selection boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_start date := date_trunc('month',coalesce(p_month,timezone('Africa/Douala',now())::date))::date;
  v_end date := (v_start + interval '1 month')::date;
  v_start_at timestamptz := v_start::timestamp AT TIME ZONE 'Africa/Douala';
  v_end_at timestamptz := v_end::timestamp AT TIME ZONE 'Africa/Douala';
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_instructor(auth.uid()) THEN
    RAISE EXCEPTION 'Instructor access required.';
  END IF;
  RETURN QUERY
  WITH latest_roles AS MATERIALIZED (
    SELECT DISTINCT ON (r.user_id) r.user_id, r.role
    FROM public.role_assignments r
    WHERE r.status IN ('active','approved') AND r.end_date IS NULL
    ORDER BY r.user_id, r.created_at DESC, CASE r.role WHEN 'instructor' THEN 0 WHEN 'sentry' THEN 1 ELSE 2 END
  ), residents AS MATERIALIZED (
    SELECT p.id, coalesce(nullif(btrim(p.display_name),''),'Full Circle member') AS name, p.avatar_url, r.role
    FROM latest_roles r JOIN public.profiles p ON p.id=r.user_id WHERE r.role IN ('cadet','sentry')
  ), punctuality AS (
    SELECT d.user_id, (count(*) FILTER (WHERE d.attendance_status='present' AND NOT coalesce(d.attendance_late,false))
      + count(*) FILTER (WHERE d.meditation_submitted AND scripture_games.meditation_submission_is_timely(d.user_id,d.record_date,d.meditation_submitted_at)))::bigint AS total
    FROM public.daily_records d WHERE d.record_date>=v_start AND d.record_date<v_end GROUP BY d.user_id
  ), insight_totals AS (
    SELECT i.user_id,count(*)::bigint AS total FROM public.scripture_verse_insights i
    WHERE i.created_at>=v_start_at AND i.created_at<v_end_at GROUP BY i.user_id
  ), comment_events AS (
    SELECT c.commenter_user_id AS user_id FROM public.daily_quote_comments c WHERE c.created_at>=v_start_at AND c.created_at<v_end_at
    UNION ALL SELECT c.commenter_user_id FROM public.daily_verse_comments c WHERE c.created_at>=v_start_at AND c.created_at<v_end_at
    UNION ALL SELECT c.user_id FROM public.scripture_insight_comments c WHERE c.created_at>=v_start_at AND c.created_at<v_end_at
  ), comment_totals AS (
    SELECT e.user_id,count(*)::bigint AS total FROM comment_events e GROUP BY e.user_id
  ), reaction_events AS (
    SELECT r.reactor_user_id AS user_id FROM public.daily_quote_reactions r WHERE r.created_at>=v_start_at AND r.created_at<v_end_at
    UNION ALL SELECT r.reactor_user_id FROM public.daily_verse_reactions r WHERE r.created_at>=v_start_at AND r.created_at<v_end_at
    UNION ALL SELECT r.reactor_user_id FROM public.scripture_insight_reactions r WHERE r.created_at>=v_start_at AND r.created_at<v_end_at
  ), reaction_totals AS (
    SELECT e.user_id,count(*)::bigint AS total FROM reaction_events e GROUP BY e.user_id
  ), fig_events AS (
    SELECT a.user_id,coalesce(a.score,0)::numeric AS figs FROM public.game_attempts a
      WHERE a.completed_at>=v_start_at AND a.completed_at<v_end_at AND a.status IN ('passed','failed')
    UNION ALL SELECT p.user_id,coalesce(p.figs_earned,p.score,0)::numeric FROM public.arena_participants p JOIN public.arena_rooms r ON r.id=p.room_id
      WHERE p.finished_at>=v_start_at AND p.finished_at<v_end_at AND r.status='completed'
    UNION ALL SELECT a.user_id,coalesce(a.talents_scored,0)::numeric FROM public.quiz_attempts a
      WHERE a.submitted_at>=v_start_at AND a.submitted_at<v_end_at AND a.status IN ('submitted','timed_out')
    UNION ALL SELECT e.user_id,e.figs::numeric FROM public.story_mode_fig_entries e WHERE e.earned_at>=v_start_at AND e.earned_at<v_end_at
  ), fig_totals AS (
    SELECT e.user_id,sum(e.figs) AS total FROM fig_events e GROUP BY e.user_id
  ), victories AS (
    SELECT r.winner_id AS user_id,count(*)::bigint AS total FROM public.arena_rooms r
    WHERE r.status='completed' AND r.completed_at>=v_start_at AND r.completed_at<v_end_at GROUP BY r.winner_id
  ), measured AS MATERIALIZED (
    SELECT p.*, coalesce(t.total,0) AS punctual,coalesce(i.total,0) AS insights,
      coalesce(c.total,0) AS comments,coalesce(r.total,0) AS reactions,
      coalesce(f.total,0)::numeric AS figs,coalesce(v.total,0)::numeric AS rhudes,
      (coalesce(t.total,0)*3 + coalesce(i.total,0)*5 + coalesce(c.total,0)*2 + coalesce(r.total,0))::numeric AS activity,
      public.calculate_normalized_marks(
        public.get_lifetime_qualifying_streak_days(p.id,v_end),
        public.get_qualifying_denarii_total(p.id,v_end_at),
        (SELECT count(*) FROM public.arena_rooms a WHERE a.winner_id=p.id AND a.status='completed' AND a.completed_at<v_end_at),
        public.get_user_lifetime_figs(p.id,v_end_at)
      ) AS marks
    FROM residents p LEFT JOIN punctuality t ON t.user_id=p.id LEFT JOIN insight_totals i ON i.user_id=p.id
    LEFT JOIN comment_totals c ON c.user_id=p.id LEFT JOIN reaction_totals r ON r.user_id=p.id
    LEFT JOIN fig_totals f ON f.user_id=p.id LEFT JOIN victories v ON v.user_id=p.id
  ), latest_membership AS (
    SELECT DISTINCT ON (m.user_id) m.user_id,m.tent_id FROM public.tent_members m WHERE m.role='cadet' ORDER BY m.user_id,m.joined_at DESC
  ), tent_totals AS (
    SELECT t.id,t.name,t.profile_image_url,sum(m.activity) AS activity,sum(m.marks) AS marks,count(*) AS residents
    FROM measured m JOIN latest_membership tm ON tm.user_id=m.id JOIN public.tents t ON t.id=tm.tent_id
    WHERE m.role='cadet' GROUP BY t.id,t.name,t.profile_image_url
  ), last_experience AS (
    SELECT e.id,e.event_date,e.event_month FROM public.fcx_events e
    WHERE e.event_date < v_end AND e.event_date <= timezone('Africa/Douala',now())::date
    ORDER BY e.event_date DESC,e.created_at DESC LIMIT 1
  ), candidates AS (
    SELECT 'Vallum'::text AS title,m.role AS target,m.id,m.name,m.avatar_url,m.activity AS score,m.marks AS secondary,
      format('%s activity points; %s Marks; %s punctual actions; %s insights; %s comments; %s reactions',m.activity,round(m.marks,2),m.punctual,m.insights,m.comments,m.reactions) AS explanation,false AS manual
    FROM measured m WHERE m.role='cadet' AND (m.activity>0 OR m.marks>0)
    UNION ALL
    SELECT 'Monthly Scribe',m.role,m.id,m.name,m.avatar_url,m.figs,0,format('%s figs earned this month across games, quizzes, Arena and Story Mode',m.figs),false
    FROM measured m WHERE m.role='cadet' AND m.figs>0
    UNION ALL
    SELECT 'Monthly Valley Champion',m.role,m.id,m.name,m.avatar_url,m.rhudes,0,format('%s Arena victories this month',m.rhudes),false
    FROM measured m WHERE m.role='cadet' AND m.rhudes>0
    UNION ALL
    SELECT 'Centurion',m.role,m.id,m.name,m.avatar_url,m.activity,m.marks,
      format('%s activity points; %s punctual actions; %s insights; %s comments; %s reactions',m.activity,m.punctual,m.insights,m.comments,m.reactions),false
    FROM measured m WHERE m.role='sentry' AND m.activity>0
    UNION ALL
    SELECT 'Messenger Award (Nuncio)',p.role,p.id,p.name,p.avatar_url,n.messenger_score,n.insight_likes,
      format('%s insight likes; %s public meditations; %s external shares',n.insight_likes,n.public_meditations,n.external_shares),false
    FROM public.get_monthly_messenger_award_metrics(v_start) n JOIN residents p ON p.id=n.user_id WHERE p.role='cadet' AND n.messenger_score>0
    UNION ALL
    SELECT 'Bethel Stone','tent',t.id,t.name,t.profile_image_url,t.activity,t.marks,
      format('%s resident activity points; %s cadets; %s combined Marks',t.activity,t.residents,round(t.marks,2)),false
    FROM tent_totals t WHERE t.activity>0 OR t.marks>0
    UNION ALL
    SELECT 'Muralis','cadet',p.id,p.name,p.avatar_url,
      CASE WHEN EXISTS (SELECT 1 FROM public.awards a WHERE a.title='Muralis' AND a.user_id=p.id AND a.award_month=to_char(e.event_month,'YYYY-MM')) THEN 1 ELSE 0 END,
      0,format('FCX participant - %s; winner selected by the instructor',to_char(e.event_date,'DD/MM/YY')),true
    FROM last_experience e JOIN public.fcx_registrations r ON r.event_id=e.id JOIN residents p ON p.id=r.user_id WHERE p.role='cadet'
  ), ranked AS (
    SELECT c.*,dense_rank() OVER (PARTITION BY c.title ORDER BY c.score DESC,c.secondary DESC) AS position FROM candidates c
  )
  SELECT r.title,r.target,r.id,r.name,r.avatar_url,r.score,r.explanation,r.position,
    (r.position=1 AND (NOT r.manual OR r.score>0)),r.manual
  FROM ranked r ORDER BY r.title,r.position,r.name,r.id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_weekly_award_metrics(
  p_week_start date DEFAULT NULL
)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_url text,
  total_figs bigint,
  quote_reactions bigint,
  quote_comments bigint,
  insight_reactions bigint,
  insight_comments bigint,
  rhetoric_score bigint,
  insight_likes bigint,
  public_meditations bigint,
  external_shares bigint,
  messenger_score bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_week_start date := coalesce(
    p_week_start,
    timezone('Africa/Douala', statement_timestamp())::date
      - (extract(isodow FROM timezone('Africa/Douala', statement_timestamp()))::integer - 1)
  );
  v_start_at timestamptz;
  v_end_at timestamptz;
BEGIN
  IF NOT public.is_instructor(auth.uid()) THEN
    RAISE EXCEPTION 'Only instructors can view award metrics.';
  END IF;

  v_start_at := v_week_start::timestamp AT TIME ZONE 'Africa/Douala';
  v_end_at := (v_week_start + 7)::timestamp AT TIME ZONE 'Africa/Douala';

  RETURN QUERY
  WITH fig_events AS (
    SELECT attempt.user_id, coalesce(attempt.score, 0)::bigint AS figs
    FROM public.game_attempts attempt
    WHERE attempt.completed_at >= v_start_at AND attempt.completed_at < v_end_at
      AND attempt.status IN ('passed', 'failed')
    UNION ALL
    SELECT participant.user_id, coalesce(participant.figs_earned,participant.score,0)::bigint
    FROM public.arena_participants participant
    JOIN public.arena_rooms room ON room.id = participant.room_id
    WHERE participant.finished_at >= v_start_at AND participant.finished_at < v_end_at
      AND room.status = 'completed'
    UNION ALL
    SELECT attempt.user_id, coalesce(attempt.talents_scored, 0)::bigint
    FROM public.quiz_attempts attempt
    WHERE attempt.submitted_at >= v_start_at AND attempt.submitted_at < v_end_at
      AND attempt.status IN ('submitted', 'timed_out')
    UNION ALL
    SELECT entry.user_id, coalesce(entry.figs, 0)::bigint
    FROM public.story_mode_fig_entries entry
    WHERE entry.earned_at >= v_start_at AND entry.earned_at < v_end_at
  ), figs AS (
    SELECT event.user_id, sum(event.figs)::bigint AS total
    FROM fig_events event
    GROUP BY event.user_id
  ), quote_reaction_totals AS (
    SELECT reaction.quote_user_id AS user_id, count(*)::bigint AS total
    FROM public.daily_quote_reactions reaction
    WHERE reaction.created_at >= v_start_at AND reaction.created_at < v_end_at
    GROUP BY reaction.quote_user_id
  ), quote_comment_totals AS (
    SELECT comment.quote_user_id AS user_id, count(*)::bigint AS total
    FROM public.daily_quote_comments comment
    WHERE comment.created_at >= v_start_at AND comment.created_at < v_end_at
    GROUP BY comment.quote_user_id
  ), insight_reaction_events AS (
    SELECT insight.user_id
    FROM public.scripture_insight_reactions reaction
    JOIN public.scripture_verse_insights insight ON insight.id = reaction.insight_id
    WHERE reaction.created_at >= v_start_at AND reaction.created_at < v_end_at
    UNION ALL
    SELECT insight.user_id
    FROM public.public_scripture_insight_reactions reaction
    JOIN public.scripture_verse_insights insight ON insight.id = reaction.insight_id
    WHERE reaction.created_at >= v_start_at AND reaction.created_at < v_end_at
  ), insight_reaction_totals AS (
    SELECT event.user_id, count(*)::bigint AS total
    FROM insight_reaction_events event
    GROUP BY event.user_id
  ), insight_comment_totals AS (
    SELECT insight.user_id, count(*)::bigint AS total
    FROM public.scripture_insight_comments comment
    JOIN public.scripture_verse_insights insight ON insight.id = comment.insight_id
    WHERE comment.created_at >= v_start_at AND comment.created_at < v_end_at
    GROUP BY insight.user_id
  ), insight_like_events AS (
    SELECT insight.user_id
    FROM public.scripture_insight_reactions reaction
    JOIN public.scripture_verse_insights insight ON insight.id = reaction.insight_id
    WHERE reaction.reaction_type = 'heart'
      AND reaction.created_at >= v_start_at AND reaction.created_at < v_end_at
    UNION ALL
    SELECT insight.user_id
    FROM public.public_scripture_insight_reactions reaction
    JOIN public.scripture_verse_insights insight ON insight.id = reaction.insight_id
    WHERE reaction.reaction_type = 'heart'
      AND reaction.created_at >= v_start_at AND reaction.created_at < v_end_at
  ), insight_like_totals AS (
    SELECT event.user_id, count(*)::bigint AS total
    FROM insight_like_events event
    GROUP BY event.user_id
  ), meditation_totals AS (
    SELECT record.user_id, count(*)::bigint AS total
    FROM public.daily_records record
    WHERE record.record_date >= v_week_start AND record.record_date < v_week_start + 7
      AND record.meditation_submitted = true
      AND record.meditation_public = true
    GROUP BY record.user_id
  ), share_totals AS (
    SELECT share.user_id, count(*)::bigint AS total
    FROM public.external_share_events share
    WHERE share.created_at >= v_start_at AND share.created_at < v_end_at
    GROUP BY share.user_id
  ), measured AS (
    SELECT
      profile.id AS user_id,
      profile.display_name,
      profile.avatar_url,
      coalesce(figs.total, 0)::bigint AS total_figs,
      coalesce(quote_reaction_totals.total, 0)::bigint AS quote_reactions,
      coalesce(quote_comment_totals.total, 0)::bigint AS quote_comments,
      coalesce(insight_reaction_totals.total, 0)::bigint AS insight_reactions,
      coalesce(insight_comment_totals.total, 0)::bigint AS insight_comments,
      coalesce(insight_like_totals.total, 0)::bigint AS insight_likes,
      coalesce(meditation_totals.total, 0)::bigint AS public_meditations,
      coalesce(share_totals.total, 0)::bigint AS external_shares
    FROM public.profiles profile
    LEFT JOIN figs ON figs.user_id = profile.id
    LEFT JOIN quote_reaction_totals ON quote_reaction_totals.user_id = profile.id
    LEFT JOIN quote_comment_totals ON quote_comment_totals.user_id = profile.id
    LEFT JOIN insight_reaction_totals ON insight_reaction_totals.user_id = profile.id
    LEFT JOIN insight_comment_totals ON insight_comment_totals.user_id = profile.id
    LEFT JOIN insight_like_totals ON insight_like_totals.user_id = profile.id
    LEFT JOIN meditation_totals ON meditation_totals.user_id = profile.id
    LEFT JOIN share_totals ON share_totals.user_id = profile.id
  )
  SELECT
    measured.user_id,
    measured.display_name,
    measured.avatar_url,
    measured.total_figs,
    measured.quote_reactions,
    measured.quote_comments,
    measured.insight_reactions,
    measured.insight_comments,
    (
      measured.quote_reactions
      + measured.quote_comments
      + measured.insight_reactions
      + measured.insight_comments
    )::bigint AS rhetoric_score,
    measured.insight_likes,
    measured.public_meditations,
    measured.external_shares,
    (measured.insight_likes + measured.public_meditations + measured.external_shares)::bigint AS messenger_score
  FROM measured
  WHERE measured.total_figs > 0
    OR measured.quote_reactions > 0
    OR measured.quote_comments > 0
    OR measured.insight_reactions > 0
    OR measured.insight_comments > 0
    OR measured.insight_likes > 0
    OR measured.public_meditations > 0
    OR measured.external_shares > 0;
END;
$$;
