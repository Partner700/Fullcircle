-- A read-only monthly watch must not depend on the live streak-reconciliation
-- path. Rank the actual month activity and keep every catalog honor represented.
CREATE OR REPLACE FUNCTION public.get_monthly_award_nominees(p_month date DEFAULT NULL)
RETURNS TABLE (
  award_title text, target_type text, target_id uuid, display_name text,
  avatar_url text, metric_value numeric, detail text, rank bigint,
  is_leader boolean, needs_selection boolean
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
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
      + count(*) FILTER (WHERE d.meditation_submitted AND (d.meditation_submitted_at AT TIME ZONE 'Africa/Douala')::time < time '21:00'))::bigint AS total
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
$$;
REVOKE ALL ON FUNCTION public.get_monthly_award_nominees(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_monthly_award_nominees(date) TO authenticated, service_role;
