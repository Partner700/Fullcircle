/*
# Mobile Money Payments

1. New Tables
- `mobile_money_payments`
  - `id` (uuid, PK)
  - `user_id` (uuid, FK to profiles, defaults to auth.uid()) — the cadet requesting the purchase
  - `relic_slug` (text) — which relic they're buying
  - `relic_name` (text) — denormalized name for display
  - `amount_usd` (numeric) — price in USD
  - `amount_local` (numeric) — price in the cadet's local currency
  - `currency_code` (text) — e.g. KES, UGX, USD
  - `provider` (text) — e.g. M-Pesa, Airtel Money, MTN
  - `sender_phone` (text) — the phone number the cadet sent money from
  - `status` (text) — 'pending', 'confirmed', 'rejected' (default 'pending')
  - `confirmed_by` (uuid, nullable) — instructor who confirmed
  - `confirmed_at` (timestamptz, nullable)
  - `rejection_reason` (text, nullable)
  - `created_at` (timestamptz, default now())

- `mobile_money_settings` (singleton — one row for the instructor)
  - `id` (int, PK, always 1)
  - `provider_name` (text) — e.g. "M-Pesa"
  - `phone_number` (text) — the number cadets send money to
  - `account_name` (text) — name on the account
  - `instructions` (text) — optional extra instructions
  - `updated_at` (timestamptz, default now())

2. Security
- `mobile_money_payments`: RLS enabled.
  - Cadets can SELECT/INSERT their own payment requests.
  - Cadets can UPDATE their own requests only while pending.
  - Instructors (role check) can SELECT all and UPDATE status (confirm/reject).
- `mobile_money_settings`: RLS enabled.
  - All authenticated users can SELECT (cadets need to see the number to send money).
  - Only instructors can INSERT/UPDATE.

3. Notes
- The confirm_payment RPC grants the relic via purchase_relic when an instructor
  marks a payment as confirmed.
- Stripe code is untouched — this is a parallel payment option.
*/

CREATE TABLE IF NOT EXISTS mobile_money_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE CASCADE,
  relic_slug text NOT NULL,
  relic_name text NOT NULL,
  amount_usd numeric NOT NULL,
  amount_local numeric NOT NULL,
  currency_code text NOT NULL DEFAULT 'USD',
  provider text NOT NULL DEFAULT 'M-Pesa',
  sender_phone text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  confirmed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE mobile_money_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_mobile_payments" ON mobile_money_payments;
CREATE POLICY "select_own_mobile_payments" ON mobile_money_payments FOR SELECT
  TO authenticated USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM profiles p
      JOIN tent_members tm ON tm.user_id = p.id
      WHERE p.id = auth.uid() AND tm.role = 'instructor'
    )
  );

DROP POLICY IF EXISTS "insert_own_mobile_payments" ON mobile_money_payments;
CREATE POLICY "insert_own_mobile_payments" ON mobile_money_payments FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_mobile_payments" ON mobile_money_payments;
CREATE POLICY "update_own_mobile_payments" ON mobile_money_payments FOR UPDATE
  TO authenticated USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND status = 'pending');

DROP POLICY IF EXISTS "instructor_update_mobile_payments" ON mobile_money_payments;
CREATE POLICY "instructor_update_mobile_payments" ON mobile_money_payments FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN tent_members tm ON tm.user_id = p.id
      WHERE p.id = auth.uid() AND tm.role = 'instructor'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN tent_members tm ON tm.user_id = p.id
      WHERE p.id = auth.uid() AND tm.role = 'instructor'
    )
  );

CREATE INDEX IF NOT EXISTS idx_mobile_money_payments_status ON mobile_money_payments (status, created_at);

-- ── Mobile money settings (singleton) ──

CREATE TABLE IF NOT EXISTS mobile_money_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  provider_name text NOT NULL DEFAULT 'M-Pesa',
  phone_number text NOT NULL DEFAULT '',
  account_name text NOT NULL DEFAULT '',
  instructions text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE mobile_money_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_mobile_money_settings" ON mobile_money_settings;
CREATE POLICY "select_mobile_money_settings" ON mobile_money_settings FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "instructor_insert_mobile_money_settings" ON mobile_money_settings;
CREATE POLICY "instructor_insert_mobile_money_settings" ON mobile_money_settings FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN tent_members tm ON tm.user_id = p.id
      WHERE p.id = auth.uid() AND tm.role = 'instructor'
    )
  );

DROP POLICY IF EXISTS "instructor_update_mobile_money_settings" ON mobile_money_settings;
CREATE POLICY "instructor_update_mobile_money_settings" ON mobile_money_settings FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN tent_members tm ON tm.user_id = p.id
      WHERE p.id = auth.uid() AND tm.role = 'instructor'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN tent_members tm ON tm.user_id = p.id
      WHERE p.id = auth.uid() AND tm.role = 'instructor'
    )
  );

-- ── Confirm payment RPC ──
-- When an instructor confirms a mobile money payment, this grants the relic
-- to the cadet via the existing purchase_relic function.

CREATE OR REPLACE FUNCTION confirm_mobile_money_payment(p_payment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_payment mobile_money_payments%ROWTYPE;
BEGIN
  SELECT * INTO v_payment FROM mobile_money_payments WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;
  IF v_payment.status != 'pending' THEN
    RAISE EXCEPTION 'Payment is already %', v_payment.status;
  END IF;

  -- Mark as confirmed
  UPDATE mobile_money_payments
    SET status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now()
    WHERE id = p_payment_id;

  -- Grant the relic to the cadet
  PERFORM purchase_relic(v_payment.user_id, v_payment.relic_slug, v_payment.currency_code);
END;
$$;

GRANT EXECUTE ON FUNCTION confirm_mobile_money_payment(uuid) TO authenticated;

-- ── Reject payment RPC ──

CREATE OR REPLACE FUNCTION reject_mobile_money_payment(p_payment_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE mobile_money_payments
    SET status = 'rejected', confirmed_by = auth.uid(), confirmed_at = now(), rejection_reason = p_reason
    WHERE id = p_payment_id AND status = 'pending';
END;
$$;

GRANT EXECUTE ON FUNCTION reject_mobile_money_payment(uuid, text) TO authenticated;
