-- A purchased use opens fifteen minutes for today's late meditation, capped at
-- Cameroon midnight. Keep every window so earned late submissions remain valid.
CREATE TABLE scripture_games.meditation_extension_windows (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 record_date date NOT NULL,
 activated_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 CHECK (expires_at > activated_at)
);
CREATE INDEX meditation_extension_user_day_idx ON scripture_games.meditation_extension_windows(user_id,record_date,expires_at);
ALTER TABLE scripture_games.meditation_extension_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON scripture_games.meditation_extension_windows FROM PUBLIC,anon,authenticated;
GRANT ALL ON scripture_games.meditation_extension_windows TO service_role;

INSERT INTO public.relic_types(slug,name,description,effect,effect_type,effect_scope,rarity,denarii_cost,money_price_usd,money_price_xaf,icon)
VALUES('hezekiahs-sundial','Hezekiah''s Sundial','After the 9 PM meditation deadline, activate a fresh 15-minute submission window. Use another after it expires. Every window closes at midnight Cameroon time.','meditation_extension','meditation_extension','streak_protection','rare',1000,NULL,NULL,'Clock3')
ON CONFLICT(slug) DO NOTHING;

CREATE FUNCTION scripture_games.meditation_extension_end(p_now timestamptz)
RETURNS timestamptz LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT least(p_now+interval '15 minutes', ((timezone('Africa/Douala',p_now)::date+1)::timestamp AT TIME ZONE 'Africa/Douala'))
$$;
REVOKE ALL ON FUNCTION scripture_games.meditation_extension_end(timestamptz) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION scripture_games.meditation_submission_is_timely(p_user uuid,p_day date,p_submitted_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT p_submitted_at IS NOT NULL
  AND timezone('Africa/Douala',p_submitted_at)::date=p_day
  AND (timezone('Africa/Douala',p_submitted_at)::time<time '21:00' OR EXISTS(
   SELECT 1 FROM scripture_games.meditation_extension_windows w
   WHERE w.user_id=p_user AND w.record_date=p_day
    AND p_submitted_at>=w.activated_at AND p_submitted_at<w.expires_at
  ))
$$;
REVOKE ALL ON FUNCTION scripture_games.meditation_submission_is_timely(uuid,date,timestamptz) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.get_meditation_extension_status()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid:=auth.uid(); v_now timestamptz:=clock_timestamp(); v_day date:=timezone('Africa/Douala',v_now)::date; v_end timestamptz;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
 SELECT max(expires_at) INTO v_end FROM scripture_games.meditation_extension_windows WHERE user_id=uid AND record_date=v_day;
 RETURN jsonb_build_object('server_now',v_now,'record_date',v_day,'expires_at',v_end,
  'owned',coalesce((SELECT sum(i.quantity) FROM public.relic_inventory i JOIN public.relic_types t ON t.id=i.relic_type_id WHERE i.user_id=uid AND t.slug='hezekiahs-sundial'),0),
  'cost',(SELECT denarii_cost FROM public.relic_types WHERE slug='hezekiahs-sundial'));
END $$;
REVOKE ALL ON FUNCTION public.get_meditation_extension_status() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_meditation_extension_status() TO authenticated;

CREATE FUNCTION public.use_meditation_extension()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid:=auth.uid(); v_now timestamptz; v_day date; v_end timestamptz;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
 PERFORM 1 FROM public.profiles WHERE id=uid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Account not found.'; END IF;
 v_now:=clock_timestamp(); v_day:=timezone('Africa/Douala',v_now)::date;
 IF timezone('Africa/Douala',v_now)::time<time '21:00' THEN RAISE EXCEPTION 'Use Hezekiah''s Sundial after the 9 PM meditation deadline.'; END IF;
 IF extract(dow FROM v_day)=0 THEN RAISE EXCEPTION 'Sunday is the day of rest; no meditation extension is needed.'; END IF;
 IF EXISTS(SELECT 1 FROM public.daily_records WHERE user_id=uid AND record_date=v_day AND meditation_submitted) THEN RAISE EXCEPTION 'Today''s meditation is already submitted.'; END IF;
 IF EXISTS(SELECT 1 FROM scripture_games.meditation_extension_windows WHERE user_id=uid AND record_date=v_day AND expires_at>v_now) THEN RAISE EXCEPTION 'Your current meditation window is still active.'; END IF;
 v_end:=scripture_games.meditation_extension_end(v_now);
 PERFORM scripture_games.consume_relic(uid,'hezekiahs-sundial','meditation-extension:'||v_day);
 INSERT INTO scripture_games.meditation_extension_windows(user_id,record_date,activated_at,expires_at) VALUES(uid,v_day,v_now,v_end);
 RETURN public.get_meditation_extension_status()||jsonb_build_object('success',true,'message','Hezekiah''s Sundial is active. Submit your meditation before the countdown ends.');
END $$;
REVOKE ALL ON FUNCTION public.use_meditation_extension() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.use_meditation_extension() TO authenticated;

-- Preserve existing attendance, history and award rules; recognize only verified late windows.
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
    UNION ALL SELECT p.user_id,coalesce(p.score,0)::numeric FROM public.arena_participants p JOIN public.arena_rooms r ON r.id=p.room_id
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
CREATE OR REPLACE FUNCTION public.get_monthly_vallum_watch(p_month date DEFAULT NULL::date)
 RETURNS TABLE(user_id uuid, display_name text, avatar_url text, marks numeric, punctual_actions bigint, insights_written bigint, comments_written bigint, reactions_given bigint, monthly_figs numeric, monthly_rhudes bigint, activity_points bigint, rank integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_month_start date := date_trunc(
    'month',
    COALESCE(p_month, timezone('Africa/Douala', now())::date)
  )::date;
  v_month_end date;
BEGIN
  IF v_caller IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.role_assignments assignment
    WHERE assignment.user_id = v_caller
      AND assignment.role = 'instructor'
      AND assignment.status IN ('active', 'approved')
  ) THEN
    RAISE EXCEPTION 'Instructor access required.';
  END IF;

  v_month_end := (v_month_start + interval '1 month')::date;

  RETURN QUERY
  WITH latest_roles AS (
    SELECT DISTINCT ON (assignment.user_id)
      assignment.user_id,
      assignment.role,
      assignment.status
    FROM public.role_assignments assignment
    WHERE assignment.status IN ('active', 'approved')
    ORDER BY assignment.user_id, assignment.created_at DESC
  ), cadets AS (
    SELECT profile.id AS user_id, profile.display_name, profile.avatar_url
    FROM latest_roles role
    JOIN public.profiles profile ON profile.id = role.user_id
    WHERE role.role = 'cadet'
  ), live_marks AS (
    SELECT board.user_id, board.marks
    FROM public.get_marks_board_live() board
  ), punctuality AS (
    SELECT
      record.user_id,
      (
        count(*) FILTER (
          WHERE record.attendance_status = 'present'
            AND COALESCE(record.attendance_late, false) = false
        )
        + count(*) FILTER (
          WHERE record.meditation_submitted = true
            AND record.meditation_submitted_at IS NOT NULL
            AND scripture_games.meditation_submission_is_timely(record.user_id,record.record_date,record.meditation_submitted_at)
        )
      )::bigint AS punctual_actions
    FROM public.daily_records record
    WHERE record.record_date >= v_month_start
      AND record.record_date < v_month_end
    GROUP BY record.user_id
  ), insights AS (
    SELECT insight.user_id, count(*)::bigint AS insights_written
    FROM public.scripture_verse_insights insight
    WHERE (insight.created_at AT TIME ZONE 'Africa/Douala')::date >= v_month_start
      AND (insight.created_at AT TIME ZONE 'Africa/Douala')::date < v_month_end
    GROUP BY insight.user_id
  ), authored_comments AS (
    SELECT comment.commenter_user_id AS user_id, comment.created_at
    FROM public.daily_quote_comments comment
    UNION ALL
    SELECT comment.commenter_user_id, comment.created_at
    FROM public.daily_verse_comments comment
    UNION ALL
    SELECT comment.user_id, comment.created_at
    FROM public.scripture_insight_comments comment
  ), comments AS (
    SELECT comment.user_id, count(*)::bigint AS comments_written
    FROM authored_comments comment
    WHERE (comment.created_at AT TIME ZONE 'Africa/Douala')::date >= v_month_start
      AND (comment.created_at AT TIME ZONE 'Africa/Douala')::date < v_month_end
    GROUP BY comment.user_id
  ), authored_reactions AS (
    SELECT reaction.reactor_user_id AS user_id, reaction.created_at
    FROM public.daily_quote_reactions reaction
    UNION ALL
    SELECT reaction.reactor_user_id, reaction.created_at
    FROM public.daily_verse_reactions reaction
    UNION ALL
    SELECT reaction.reactor_user_id, reaction.created_at
    FROM public.scripture_insight_reactions reaction
  ), reactions AS (
    SELECT reaction.user_id, count(*)::bigint AS reactions_given
    FROM authored_reactions reaction
    WHERE (reaction.created_at AT TIME ZONE 'Africa/Douala')::date >= v_month_start
      AND (reaction.created_at AT TIME ZONE 'Africa/Douala')::date < v_month_end
    GROUP BY reaction.user_id
  ), quiz_figs AS (
    SELECT
      attempt.user_id,
      COALESCE(sum(attempt.talents_scored), 0)::numeric AS monthly_figs
    FROM public.quiz_attempts attempt
    WHERE attempt.status IN ('submitted', 'timed_out')
      AND attempt.submitted_at >= (v_month_start::timestamp AT TIME ZONE 'Africa/Douala')
      AND attempt.submitted_at < (v_month_end::timestamp AT TIME ZONE 'Africa/Douala')
    GROUP BY attempt.user_id
  ), arena_rhudes AS (
    SELECT room.winner_id AS user_id, count(*)::bigint AS monthly_rhudes
    FROM public.arena_rooms room
    WHERE room.status = 'completed'
      AND room.winner_id IS NOT NULL
      AND room.completed_at >= (v_month_start::timestamp AT TIME ZONE 'Africa/Douala')
      AND room.completed_at < (v_month_end::timestamp AT TIME ZONE 'Africa/Douala')
    GROUP BY room.winner_id
  ), measured AS (
    SELECT
      cadet.user_id,
      COALESCE(NULLIF(btrim(cadet.display_name), ''), 'Cadet') AS display_name,
      cadet.avatar_url,
      COALESCE(live_marks.marks, 0)::numeric AS marks,
      COALESCE(punctuality.punctual_actions, 0)::bigint AS punctual_actions,
      COALESCE(insights.insights_written, 0)::bigint AS insights_written,
      COALESCE(comments.comments_written, 0)::bigint AS comments_written,
      COALESCE(reactions.reactions_given, 0)::bigint AS reactions_given,
      COALESCE(quiz_figs.monthly_figs, 0)::numeric AS monthly_figs,
      COALESCE(arena_rhudes.monthly_rhudes, 0)::bigint AS monthly_rhudes,
      (
        COALESCE(punctuality.punctual_actions, 0) * 3
        + COALESCE(insights.insights_written, 0) * 5
        + COALESCE(comments.comments_written, 0) * 2
        + COALESCE(reactions.reactions_given, 0)
      )::bigint AS activity_points
    FROM cadets cadet
    LEFT JOIN live_marks ON live_marks.user_id = cadet.user_id
    LEFT JOIN punctuality ON punctuality.user_id = cadet.user_id
    LEFT JOIN insights ON insights.user_id = cadet.user_id
    LEFT JOIN comments ON comments.user_id = cadet.user_id
    LEFT JOIN reactions ON reactions.user_id = cadet.user_id
    LEFT JOIN quiz_figs ON quiz_figs.user_id = cadet.user_id
    LEFT JOIN arena_rhudes ON arena_rhudes.user_id = cadet.user_id
  )
  SELECT
    measured.user_id,
    measured.display_name,
    measured.avatar_url,
    measured.marks,
    measured.punctual_actions,
    measured.insights_written,
    measured.comments_written,
    measured.reactions_given,
    measured.monthly_figs,
    measured.monthly_rhudes,
    measured.activity_points,
    row_number() OVER (
      ORDER BY measured.activity_points DESC, measured.marks DESC, measured.display_name ASC
    )::integer AS rank
  FROM measured
  WHERE measured.activity_points > 0
     OR measured.marks > 0
     OR measured.monthly_figs > 0
     OR measured.monthly_rhudes > 0
  ORDER BY 12 ASC;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.is_streak_day_complete(p_user_id uuid, p_date date)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_required_streak_day(p_date) THEN
    RETURN false;
  END IF;

  IF EXTRACT(DOW FROM p_date) = 6 THEN
    RETURN
      EXISTS (
        SELECT 1
        FROM public.quiz_attempts qa
        JOIN public.quiz_sessions qs ON qs.id = qa.quiz_session_id
        WHERE qa.user_id = p_user_id
          AND qs.session_date = p_date
          AND qs.quiz_type = 'saturday'
          AND qa.status = 'submitted'
      )
      OR EXISTS (
        SELECT 1
        FROM public.daily_records dr
        WHERE dr.user_id = p_user_id
          AND dr.record_date = p_date
          AND COALESCE(dr.streak_valid, false) = true
      )
      OR EXISTS (
        SELECT 1
        FROM public.streak_freezers sf
        WHERE sf.user_id = p_user_id
          AND sf.applied_to_date = p_date
          AND sf.freezer_type = 'weekly'
          AND sf.source = 'relic'
      );
  END IF;

  RETURN
    EXISTS (
      SELECT 1
      FROM public.daily_records dr
      WHERE dr.user_id = p_user_id
        AND dr.record_date = p_date
        AND (
          COALESCE(dr.streak_valid, false) = true
          OR (
            COALESCE(dr.attendance_status, 'unmarked') = 'present'
            AND COALESCE(dr.meditation_submitted, false) = true
            AND (
              dr.meditation_submitted_at IS NULL
              OR scripture_games.meditation_submission_is_timely(dr.user_id,dr.record_date,dr.meditation_submitted_at)
            )
          )
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.streak_freezers sf
      WHERE sf.user_id = p_user_id
        AND sf.applied_to_date = p_date
        AND (sf.expires_at IS NULL OR sf.expires_at >= p_date)
    );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.mark_cadet_attendance(p_sentry_id uuid, p_cadet_id uuid, p_record_date text, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_local_now timestamp := timezone('Africa/Douala', now());
  v_record_date date;
  v_day_type text;
  v_attendance_late boolean;
  v_record public.daily_records%ROWTYPE;
  v_reward_awarded boolean := false;
  v_reward_removed boolean := false;
  v_reward_id uuid;
BEGIN
  IF v_caller IS NULL OR v_caller IS DISTINCT FROM p_sentry_id THEN
    RAISE EXCEPTION 'You can only mark attendance from your own account.';
  END IF;
  IF p_record_date !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'Invalid attendance date.';
  END IF;
  v_record_date := p_record_date::date;
  IF v_record_date IS DISTINCT FROM v_local_now::date THEN
    RAISE EXCEPTION 'Attendance can only be marked for today.';
  END IF;
  IF p_status NOT IN ('present', 'absent') THEN
    RAISE EXCEPTION 'Attendance status must be present or absent.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.tent_members cadet_member
    JOIN public.tents tent ON tent.id = cadet_member.tent_id
    LEFT JOIN public.tent_members sentry_member
      ON sentry_member.tent_id = tent.id
      AND sentry_member.user_id = v_caller
      AND sentry_member.role = 'sentry'
    WHERE cadet_member.user_id = p_cadet_id
      AND cadet_member.role = 'cadet'
      AND (tent.sentry_id = v_caller OR sentry_member.id IS NOT NULL)
  )
  AND NOT public.is_instructor(v_caller) THEN
    RAISE EXCEPTION 'You can only mark attendance for cadets in your assigned tent.';
  END IF;

  v_day_type := CASE
    WHEN extract(dow FROM v_record_date) = 0 THEN 'sunday'
    WHEN extract(dow FROM v_record_date) = 6 THEN 'saturday'
    ELSE 'weekday'
  END;
  v_attendance_late := v_local_now::time >= time '12:00';

  INSERT INTO public.daily_records (
    user_id, record_date, day_type, attendance_status,
    attendance_marked_at, attendance_marked_by, attendance_late,
    meditation_submitted, streak_valid
  ) VALUES (
    p_cadet_id, v_record_date, v_day_type, p_status,
    now(), v_caller, v_attendance_late, false,
    CASE WHEN v_day_type = 'sunday' THEN NULL ELSE false END
  )
  ON CONFLICT (user_id, record_date) DO UPDATE SET
    day_type = EXCLUDED.day_type,
    attendance_status = EXCLUDED.attendance_status,
    attendance_marked_at = CASE
      WHEN public.daily_records.attendance_marked_at IS NOT NULL
      THEN public.daily_records.attendance_marked_at
      ELSE EXCLUDED.attendance_marked_at
    END,
    attendance_marked_by = EXCLUDED.attendance_marked_by,
    attendance_late = CASE
      WHEN public.daily_records.attendance_marked_at IS NOT NULL
      THEN coalesce(public.daily_records.attendance_late, false)
      ELSE EXCLUDED.attendance_late
    END,
    streak_valid = CASE
      WHEN EXCLUDED.day_type = 'sunday' THEN NULL
      WHEN EXCLUDED.day_type = 'weekday' THEN
        EXCLUDED.attendance_status = 'present'
        AND coalesce(public.daily_records.meditation_submitted, false)
        AND (
          public.daily_records.meditation_submitted_at IS NULL
          OR scripture_games.meditation_submission_is_timely(public.daily_records.user_id,public.daily_records.record_date,public.daily_records.meditation_submitted_at)
        )
      ELSE coalesce(public.daily_records.quiz_attempt_id IS NOT NULL, false)
    END
  RETURNING * INTO v_record;

  -- Marking at least one cadet before midday supplies the sentry's attendance
  -- half. Their own meditation completes the weekday streak immediately.
  IF v_day_type = 'weekday' AND NOT v_attendance_late AND public.is_sentry(v_caller) THEN
    INSERT INTO public.daily_records (
      user_id, record_date, day_type, attendance_status,
      attendance_marked_at, attendance_marked_by, attendance_late,
      meditation_submitted, streak_valid
    ) VALUES (
      v_caller, v_record_date, v_day_type, 'present',
      now(), v_caller, false, false, false
    )
    ON CONFLICT (user_id, record_date) DO UPDATE SET
      day_type = EXCLUDED.day_type,
      attendance_status = CASE
        WHEN coalesce(public.daily_records.attendance_status, 'unmarked') <> 'absent' THEN 'present'
        ELSE public.daily_records.attendance_status
      END,
      attendance_marked_at = coalesce(public.daily_records.attendance_marked_at, EXCLUDED.attendance_marked_at),
      attendance_marked_by = EXCLUDED.attendance_marked_by,
      attendance_late = false,
      streak_valid = CASE
        WHEN coalesce(public.daily_records.attendance_status, 'unmarked') <> 'absent'
          AND coalesce(public.daily_records.meditation_submitted, false)
          AND (
            public.daily_records.meditation_submitted_at IS NULL
            OR scripture_games.meditation_submission_is_timely(public.daily_records.user_id,public.daily_records.record_date,public.daily_records.meditation_submitted_at)
          )
        THEN true
        ELSE coalesce(public.daily_records.streak_valid, false)
      END;
  END IF;

  IF p_status = 'present' THEN
    INSERT INTO public.denarii_ledger_entries (
      user_id, amount, source_type, source_reference, description
    )
    SELECT p_cadet_id, 200, 'attendance', v_record_date::text, 'Attendance reward'
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.denarii_ledger_entries entry
      WHERE entry.user_id = p_cadet_id
        AND entry.source_type = 'attendance'
        AND entry.source_reference = v_record_date::text
        AND entry.amount = 200
    )
    RETURNING id INTO v_reward_id;
    v_reward_awarded := v_reward_id IS NOT NULL;
  ELSE
    WITH deleted AS (
      DELETE FROM public.denarii_ledger_entries entry
      WHERE entry.user_id = p_cadet_id
        AND entry.source_type = 'attendance'
        AND entry.source_reference = v_record_date::text
        AND entry.amount = 200
      RETURNING entry.id
    )
    SELECT EXISTS(SELECT 1 FROM deleted) INTO v_reward_removed;
  END IF;

  RETURN jsonb_build_object(
    'record_id', v_record.id,
    'attendance_status', v_record.attendance_status,
    'attendance_late', v_record.attendance_late,
    'reward_awarded', v_reward_awarded,
    'reward_removed', v_reward_removed,
    'devotion_submitted', coalesce(v_record.meditation_submitted, false),
    'streak_valid', v_record.streak_valid
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.streak_requirement_met(p_user_id uuid, p_record_date date)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_record_date < date '2026-08-10' AND EXISTS (
    SELECT 1
    FROM public.daily_records historical
    WHERE historical.user_id = p_user_id
      AND historical.record_date = p_record_date
      AND historical.streak_valid IS TRUE
  ) THEN
    RETURN true;
  END IF;

  IF extract(dow FROM p_record_date) = 0 THEN
    RETURN p_record_date >= date '2026-08-02' AND EXISTS (
      SELECT 1
      FROM public.daily_records record
      WHERE record.user_id = p_user_id
        AND record.record_date = p_record_date
        AND record.sunday_reading_opened_at IS NOT NULL
        AND (record.sunday_reading_opened_at AT TIME ZONE 'Africa/Douala')::time < time '21:00'
    );
  END IF;

  IF extract(dow FROM p_record_date) = 6 THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.quiz_attempts attempt
      JOIN public.quiz_sessions session ON session.id = attempt.quiz_session_id
      WHERE attempt.user_id = p_user_id
        AND session.session_date = p_record_date
        AND session.quiz_type = 'saturday'
        AND attempt.status IN ('submitted', 'timed_out')
    );
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.daily_records record
    WHERE record.user_id = p_user_id
      AND record.record_date = p_record_date
      AND coalesce(record.meditation_submitted, false)
      AND (
        (
          record.meditation_submitted_at IS NOT NULL
          AND scripture_games.meditation_submission_is_timely(record.user_id,record.record_date,record.meditation_submitted_at)
        )
        OR (
          p_record_date < date '2026-08-10'
          AND record.meditation_submitted_at IS NULL
        )
      )
      AND (
        /* The authorized sentry/instructor status is the attendance fact.
           The entry timestamp remains available for punctuality reporting. */
        coalesce(record.attendance_status, 'unmarked') = 'present'
        OR EXISTS (
          /* Sentry duty is still earned only by actually recording at least
             one cadet before noon. This branch is intentionally unchanged. */
          SELECT 1
          FROM public.daily_records marked
          WHERE marked.record_date = p_record_date
            AND marked.attendance_marked_by = p_user_id
            AND marked.attendance_marked_at IS NOT NULL
            AND (marked.attendance_marked_at AT TIME ZONE 'Africa/Douala')::time < time '12:00'
        )
      )
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.submit_daily_meditation(p_record_date date, p_meditation_text text, p_best_verse text, p_daily_quote text)
 RETURNS daily_records
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_submission_at timestamptz := clock_timestamp();
  v_local_now timestamp := timezone('Africa/Douala', v_submission_at);
  v_day_type text;
  v_record public.daily_records%ROWTYPE;
  v_meditation_words integer;
  v_quote_words integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_record_date IS DISTINCT FROM v_local_now::date THEN
    RAISE EXCEPTION 'Meditations can only be submitted for today.';
  END IF;

  v_day_type := CASE
    WHEN extract(dow FROM p_record_date) = 0 THEN 'sunday'
    WHEN extract(dow FROM p_record_date) = 6 THEN 'saturday'
    ELSE 'weekday'
  END;

  IF v_day_type = 'sunday' THEN
    RAISE EXCEPTION 'Sunday is the day of rest; no meditation is required.';
  END IF;

  IF v_local_now::time >= time '21:00' AND NOT scripture_games.meditation_submission_is_timely(v_user_id,p_record_date,v_submission_at) THEN
    RAISE EXCEPTION 'Streak submissions close at 9:00 PM.';
  END IF;

  v_meditation_words := cardinality(regexp_split_to_array(btrim(coalesce(p_meditation_text, '')), '\s+'));
  v_quote_words := cardinality(regexp_split_to_array(btrim(coalesce(p_daily_quote, '')), '\s+'));

  IF btrim(coalesce(p_best_verse, '')) = '' THEN
    RAISE EXCEPTION 'Select your best verse before submitting.';
  END IF;
  IF v_meditation_words < 50 THEN
    RAISE EXCEPTION 'Meditation of the Day must contain at least 50 words.';
  END IF;
  IF btrim(coalesce(p_daily_quote, '')) = '' OR v_quote_words < 1 OR v_quote_words > 10 THEN
    RAISE EXCEPTION 'Quote of the Day must contain between 1 and 10 words.';
  END IF;

  INSERT INTO public.daily_records (
    user_id, record_date, day_type, meditation_submitted,
    meditation_submitted_at, meditation_text, best_verse, daily_quote,
    streak_valid
  ) VALUES (
    v_user_id, p_record_date, v_day_type, true,
    v_submission_at, btrim(p_meditation_text), btrim(p_best_verse), btrim(p_daily_quote),
    CASE
      WHEN v_day_type = 'weekday' THEN false
      ELSE false
    END
  )
  ON CONFLICT (user_id, record_date) DO UPDATE SET
    day_type = EXCLUDED.day_type,
    meditation_submitted = true,
    meditation_submitted_at = v_submission_at,
    meditation_text = EXCLUDED.meditation_text,
    best_verse = EXCLUDED.best_verse,
    daily_quote = EXCLUDED.daily_quote,
    streak_valid = CASE
      WHEN EXCLUDED.day_type = 'weekday' THEN
        coalesce(public.daily_records.attendance_status, 'unmarked') = 'present'
      ELSE coalesce(public.daily_records.quiz_attempt_id IS NOT NULL, false)
    END
  RETURNING * INTO v_record;

  RETURN v_record;
END;
$function$
;

