/* Browser-notification consent and the one-time 50 Denarii opt-in reward. */

ALTER TABLE public.denarii_ledger_entries
  DROP CONSTRAINT IF EXISTS denarii_ledger_entries_source_type_check;

ALTER TABLE public.denarii_ledger_entries
  ADD CONSTRAINT denarii_ledger_entries_source_type_check
  CHECK (source_type IN (
    'game_level', 'game_blitz', 'quiz_reward', 'fortune_quiz_reward',
    'relic_purchase', 'relic_reward', 'admin_adjustment',
    'hint_purchase', 'answer_reveal', 'freezer_daily', 'freezer_weekly',
    'attendance', 'arena_stake', 'arena_fee', 'arena_reward',
    'mobile_money', 'campay_payment', 'notification_opt_in'
  ));

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  rewarded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_own_notification_preferences" ON public.notification_preferences;
CREATE POLICY "read_own_notification_preferences" ON public.notification_preferences
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.enable_browser_notifications()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_rewarded boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  INSERT INTO public.notification_preferences (user_id, enabled)
  VALUES (v_user_id, true)
  ON CONFLICT (user_id) DO UPDATE
    SET enabled = true, updated_at = now();

  IF NOT EXISTS (
    SELECT 1 FROM public.notification_preferences
    WHERE user_id = v_user_id AND rewarded_at IS NOT NULL
  ) THEN
    INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, description)
    VALUES (v_user_id, 50, 'notification_opt_in', 'Enabled device notifications');
    UPDATE public.notification_preferences
      SET rewarded_at = now(), updated_at = now()
      WHERE user_id = v_user_id;
    v_rewarded := true;
  END IF;

  RETURN jsonb_build_object('enabled', true, 'reward_granted', v_rewarded);
END;
$$;

GRANT EXECUTE ON FUNCTION public.enable_browser_notifications() TO authenticated;
