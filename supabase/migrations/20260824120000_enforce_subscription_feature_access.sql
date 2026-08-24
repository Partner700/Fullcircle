/* Enforce the paid/trial boundary in Postgres as well as the interface.

   Instructors retain administrative access. Cadets and sentries may continue
   reading public camp material after expiry, but cannot create streak-bearing
   submissions, play paid games or quizzes, use the Market, or read/write chat.
*/

CREATE OR REPLACE FUNCTION public.has_current_subscription_access(
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_user_id IS NOT NULL AND (
    public.is_instructor(p_user_id)
    OR EXISTS (
      SELECT 1
      FROM public.subscriptions subscription
      WHERE subscription.user_id = p_user_id
        AND (
          (
            subscription.status = 'trial'
            AND subscription.trial_ends_at > now()
          )
          OR (
            subscription.status = 'active'
            AND (
              subscription.current_period_end IS NULL
              OR subscription.current_period_end > now()
            )
          )
          OR subscription.status = 'grace'
        )
    )
  );
$$;

REVOKE ALL ON FUNCTION public.has_current_subscription_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_current_subscription_access(uuid) TO authenticated, service_role;

/* SECURITY DEFINER game and submission RPCs still pass through table triggers.
   The JWT identity remains available through auth.uid(), so stale clients
   cannot bypass expiry by invoking an RPC directly. */
CREATE OR REPLACE FUNCTION public.enforce_owned_subscription_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_text text;
  v_owner_id uuid;
BEGIN
  IF auth.uid() IS NULL OR auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  v_owner_text := coalesce(to_jsonb(NEW)->>'user_id', to_jsonb(NEW)->>'sender_id');
  IF nullif(v_owner_text, '') IS NULL THEN
    RETURN NEW;
  END IF;
  v_owner_id := v_owner_text::uuid;

  IF v_owner_id = auth.uid()
     AND NOT public.has_current_subscription_access(auth.uid()) THEN
    RAISE EXCEPTION 'SUBSCRIPTION_REQUIRED: Your subscription or free trial has expired.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_owned_subscription_write() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_owned_subscription_write() TO service_role;

DROP TRIGGER IF EXISTS enforce_subscription_daily_records ON public.daily_records;
CREATE TRIGGER enforce_subscription_daily_records
BEFORE INSERT OR UPDATE ON public.daily_records
FOR EACH ROW EXECUTE FUNCTION public.enforce_owned_subscription_write();

DROP TRIGGER IF EXISTS enforce_subscription_challenge_submissions ON public.challenge_submissions;
CREATE TRIGGER enforce_subscription_challenge_submissions
BEFORE INSERT OR UPDATE ON public.challenge_submissions
FOR EACH ROW EXECUTE FUNCTION public.enforce_owned_subscription_write();

DROP TRIGGER IF EXISTS enforce_subscription_daily_game_runs ON public.daily_game_runs;
CREATE TRIGGER enforce_subscription_daily_game_runs
BEFORE INSERT OR UPDATE ON public.daily_game_runs
FOR EACH ROW EXECUTE FUNCTION public.enforce_owned_subscription_write();

DROP TRIGGER IF EXISTS enforce_subscription_game_attempts ON public.game_attempts;
CREATE TRIGGER enforce_subscription_game_attempts
BEFORE INSERT OR UPDATE ON public.game_attempts
FOR EACH ROW EXECUTE FUNCTION public.enforce_owned_subscription_write();

DROP TRIGGER IF EXISTS enforce_subscription_quiz_attempts ON public.quiz_attempts;
CREATE TRIGGER enforce_subscription_quiz_attempts
BEFORE INSERT OR UPDATE ON public.quiz_attempts
FOR EACH ROW EXECUTE FUNCTION public.enforce_owned_subscription_write();

DROP TRIGGER IF EXISTS enforce_subscription_denarii_ledger ON public.denarii_ledger_entries;
CREATE TRIGGER enforce_subscription_denarii_ledger
BEFORE INSERT OR UPDATE ON public.denarii_ledger_entries
FOR EACH ROW EXECUTE FUNCTION public.enforce_owned_subscription_write();

DROP TRIGGER IF EXISTS enforce_subscription_scripture_insights ON public.scripture_verse_insights;
CREATE TRIGGER enforce_subscription_scripture_insights
BEFORE INSERT OR UPDATE ON public.scripture_verse_insights
FOR EACH ROW EXECUTE FUNCTION public.enforce_owned_subscription_write();

DROP TRIGGER IF EXISTS enforce_subscription_scripture_replies ON public.scripture_insight_comments;
CREATE TRIGGER enforce_subscription_scripture_replies
BEFORE INSERT OR UPDATE ON public.scripture_insight_comments
FOR EACH ROW EXECUTE FUNCTION public.enforce_owned_subscription_write();

DROP TRIGGER IF EXISTS enforce_subscription_tent_messages ON public.tent_messages;
CREATE TRIGGER enforce_subscription_tent_messages
BEFORE INSERT OR UPDATE ON public.tent_messages
FOR EACH ROW EXECUTE FUNCTION public.enforce_owned_subscription_write();

DROP TRIGGER IF EXISTS enforce_subscription_tent_group_messages ON public.tent_group_messages;
CREATE TRIGGER enforce_subscription_tent_group_messages
BEFORE INSERT OR UPDATE ON public.tent_group_messages
FOR EACH ROW EXECUTE FUNCTION public.enforce_owned_subscription_write();

DROP TRIGGER IF EXISTS enforce_subscription_direct_messages ON public.direct_messages;
CREATE TRIGGER enforce_subscription_direct_messages
BEFORE INSERT OR UPDATE ON public.direct_messages
FOR EACH ROW EXECUTE FUNCTION public.enforce_owned_subscription_write();

DROP TRIGGER IF EXISTS enforce_subscription_quiz_waiting_messages ON public.quiz_waiting_messages;
CREATE TRIGGER enforce_subscription_quiz_waiting_messages
BEFORE INSERT OR UPDATE ON public.quiz_waiting_messages
FOR EACH ROW EXECUTE FUNCTION public.enforce_owned_subscription_write();

/* Message history becomes unreadable after expiry and reappears unchanged as
   soon as access is restored. */
DROP POLICY IF EXISTS "direct_messages_select_participants" ON public.direct_messages;
CREATE POLICY "direct_messages_select_participants"
ON public.direct_messages FOR SELECT TO authenticated
USING (
  public.has_current_subscription_access(auth.uid())
  AND (auth.uid() = sender_id OR auth.uid() = recipient_id)
);

DROP POLICY IF EXISTS "direct_messages_insert_sender" ON public.direct_messages;
CREATE POLICY "direct_messages_insert_sender"
ON public.direct_messages FOR INSERT TO authenticated
WITH CHECK (
  public.has_current_subscription_access(auth.uid())
  AND auth.uid() = sender_id
  AND sender_id <> recipient_id
);

DROP POLICY IF EXISTS "direct_messages_update_recipient_read" ON public.direct_messages;
CREATE POLICY "direct_messages_update_recipient_read"
ON public.direct_messages FOR UPDATE TO authenticated
USING (public.has_current_subscription_access(auth.uid()) AND auth.uid() = recipient_id)
WITH CHECK (public.has_current_subscription_access(auth.uid()) AND auth.uid() = recipient_id);

DROP POLICY IF EXISTS "select_own_tent_messages" ON public.tent_messages;
CREATE POLICY "select_own_tent_messages"
ON public.tent_messages FOR SELECT TO authenticated
USING (
  public.has_current_subscription_access(auth.uid())
  AND (sender_id = auth.uid() OR recipient_id = auth.uid())
);

DROP POLICY IF EXISTS "insert_own_tent_messages" ON public.tent_messages;
CREATE POLICY "insert_own_tent_messages"
ON public.tent_messages FOR INSERT TO authenticated
WITH CHECK (public.has_current_subscription_access(auth.uid()) AND sender_id = auth.uid());

DROP POLICY IF EXISTS "update_own_tent_messages" ON public.tent_messages;
CREATE POLICY "update_own_tent_messages"
ON public.tent_messages FOR UPDATE TO authenticated
USING (public.has_current_subscription_access(auth.uid()) AND recipient_id = auth.uid())
WITH CHECK (public.has_current_subscription_access(auth.uid()) AND recipient_id = auth.uid());

DROP POLICY IF EXISTS "delete_own_tent_messages" ON public.tent_messages;
CREATE POLICY "delete_own_tent_messages"
ON public.tent_messages FOR DELETE TO authenticated
USING (public.has_current_subscription_access(auth.uid()) AND sender_id = auth.uid());

/* Do not expose message previews through the notification centre while chat
   is locked. The rows remain intact and become visible after renewal. */
DROP POLICY IF EXISTS "select_own_user_notifications" ON public.user_notifications;
CREATE POLICY "select_own_user_notifications"
ON public.user_notifications FOR SELECT TO authenticated
USING (
  recipient_id = auth.uid()
  AND (
    notification_type NOT IN ('message', 'direct_message', 'message_mention')
    OR public.has_current_subscription_access(auth.uid())
  )
);

DROP POLICY IF EXISTS tent_group_messages_select_members ON public.tent_group_messages;
CREATE POLICY tent_group_messages_select_members
ON public.tent_group_messages FOR SELECT TO authenticated
USING (
  public.has_current_subscription_access(auth.uid())
  AND (
    EXISTS (
      SELECT 1 FROM public.tent_members member
      WHERE member.tent_id = tent_group_messages.tent_id
        AND member.user_id = auth.uid()
    )
    OR public.is_instructor(auth.uid())
  )
);

DROP POLICY IF EXISTS tent_group_messages_insert_members ON public.tent_group_messages;
CREATE POLICY tent_group_messages_insert_members
ON public.tent_group_messages FOR INSERT TO authenticated
WITH CHECK (
  public.has_current_subscription_access(auth.uid())
  AND sender_id = auth.uid()
  AND (
    EXISTS (
      SELECT 1 FROM public.tent_members member
      WHERE member.tent_id = tent_group_messages.tent_id
        AND member.user_id = auth.uid()
    )
    OR public.is_instructor(auth.uid())
  )
);

/* Existing insights stay readable; only authoring and editing require access. */
DROP POLICY IF EXISTS "Users manage their scripture insights" ON public.scripture_verse_insights;
DROP POLICY IF EXISTS "subscription users insert scripture insights" ON public.scripture_verse_insights;
CREATE POLICY "subscription users insert scripture insights"
ON public.scripture_verse_insights FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND public.has_current_subscription_access(auth.uid()));

DROP POLICY IF EXISTS "subscription users update scripture insights" ON public.scripture_verse_insights;
CREATE POLICY "subscription users update scripture insights"
ON public.scripture_verse_insights FOR UPDATE TO authenticated
USING (auth.uid() = user_id AND public.has_current_subscription_access(auth.uid()))
WITH CHECK (auth.uid() = user_id AND public.has_current_subscription_access(auth.uid()));

DROP POLICY IF EXISTS "users delete their scripture insights" ON public.scripture_verse_insights;
CREATE POLICY "users delete their scripture insights"
ON public.scripture_verse_insights FOR DELETE TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users create their insight comments" ON public.scripture_insight_comments;
CREATE POLICY "Users create their insight comments"
ON public.scripture_insight_comments FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND public.has_current_subscription_access(auth.uid()));

DROP POLICY IF EXISTS "insert_challenge_own" ON public.challenge_submissions;
CREATE POLICY "insert_challenge_own"
ON public.challenge_submissions FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND status = 'pending'
  AND public.has_current_subscription_access(auth.uid())
);

DROP POLICY IF EXISTS "update_challenge_own" ON public.challenge_submissions;
CREATE POLICY "update_challenge_own"
ON public.challenge_submissions FOR UPDATE TO authenticated
USING (
  auth.uid() = user_id
  AND status IN ('pending', 'rejected')
  AND public.has_current_subscription_access(auth.uid())
)
WITH CHECK (
  auth.uid() = user_id
  AND status = 'pending'
  AND reviewed_by IS NULL
  AND public.has_current_subscription_access(auth.uid())
);

DROP POLICY IF EXISTS "active users read quiz waiting chat" ON public.quiz_waiting_messages;
DROP POLICY IF EXISTS "authenticated users read quiz waiting chat" ON public.quiz_waiting_messages;
CREATE POLICY "active subscribers read quiz waiting chat"
ON public.quiz_waiting_messages FOR SELECT TO authenticated
USING (
  public.has_current_subscription_access(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.role_assignments assignment
    WHERE assignment.user_id = auth.uid()
      AND assignment.status IN ('active', 'approved')
  )
);

DROP POLICY IF EXISTS "active users write open quiz waiting chat" ON public.quiz_waiting_messages;
DROP POLICY IF EXISTS "authenticated users write quiz waiting chat" ON public.quiz_waiting_messages;
CREATE POLICY "active subscribers write open quiz waiting chat"
ON public.quiz_waiting_messages FOR INSERT TO authenticated
WITH CHECK (
  public.has_current_subscription_access(auth.uid())
  AND sender_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.role_assignments assignment
    WHERE assignment.user_id = auth.uid()
      AND assignment.status IN ('active', 'approved')
  )
  AND EXISTS (
    SELECT 1 FROM public.quiz_sessions session
    WHERE session.id = quiz_waiting_messages.quiz_session_id
      AND session.status <> 'closed'
  )
);
