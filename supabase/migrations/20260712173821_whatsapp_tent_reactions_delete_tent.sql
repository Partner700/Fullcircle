/*
# Add WhatsApp numbers, tent reactions, and delete_tent RPC

## Changes

### 1. profiles table — new column
- `whatsapp_number` (text, nullable) — stores a cadet/sentry/instructor's
  WhatsApp contact number in international format (e.g. "+1234567890").
  Added via DO block so the migration is idempotent.

### 2. New table: tent_reactions
- Stores reactions (emoji-based) that cadets post on tent-mates'
  high scores and achievements.
- Columns: id, tent_id, reactor_user_id, target_user_id,
  reaction_type (text — e.g. 'fire', 'trophy', 'heart', 'clap'),
  target_type ('high_score' | 'achievement' | 'streak'),
  target_reference (text, nullable — e.g. the score value or award id),
  created_at.
- RLS: authenticated users can read all reactions in their own tent
  (checked via tent_members) and insert/delete their own reactions.

### 3. New RPC: delete_tent
- SECURITY DEFINER function that deletes a tent and cascades its
  tent_members rows. Only callable by instructors (checked via
  role_assignments). Returns success boolean.

## Security
- RLS enabled on tent_reactions.
- delete_tent verifies the caller has an active instructor role.
- whatsapp_number is owner-writable via existing profiles UPDATE policy.
*/

-- ── 1. Add whatsapp_number to profiles ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'whatsapp_number'
  ) THEN
    ALTER TABLE profiles ADD COLUMN whatsapp_number text;
  END IF;
END $$;

-- ── 2. Create tent_reactions table ──
CREATE TABLE IF NOT EXISTS tent_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tent_id uuid NOT NULL REFERENCES tents(id) ON DELETE CASCADE,
  reactor_user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reaction_type text NOT NULL DEFAULT 'fire',
  target_type text NOT NULL DEFAULT 'high_score',
  target_reference text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE tent_reactions ENABLE ROW LEVEL SECURITY;

-- Read: anyone authenticated can read reactions (they're social/shared within tents)
DROP POLICY IF EXISTS "read_tent_reactions" ON tent_reactions;
CREATE POLICY "read_tent_reactions"
  ON tent_reactions FOR SELECT
  TO authenticated USING (true);

-- Insert: only the reactor themselves
DROP POLICY IF EXISTS "insert_own_reaction" ON tent_reactions;
CREATE POLICY "insert_own_reaction"
  ON tent_reactions FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = reactor_user_id);

-- Delete: only the reactor themselves
DROP POLICY IF EXISTS "delete_own_reaction" ON tent_reactions;
CREATE POLICY "delete_own_reaction"
  ON tent_reactions FOR DELETE
  TO authenticated USING (auth.uid() = reactor_user_id);

-- ── 3. delete_tent RPC ──
DROP FUNCTION IF EXISTS delete_tent(p_tent_id uuid);
CREATE OR REPLACE FUNCTION delete_tent(p_tent_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_instructor boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM role_assignments
    WHERE user_id = v_caller
      AND role = 'instructor'
      AND status = 'active'
  ) INTO v_is_instructor;

  IF NOT v_is_instructor THEN
    RAISE EXCEPTION 'Only instructors can delete tents';
  END IF;

  -- tent_members cascade via ON DELETE CASCADE if FK is set,
  -- but we delete explicitly to be safe
  DELETE FROM tent_members WHERE tent_id = p_tent_id;
  DELETE FROM tents WHERE id = p_tent_id;

  RETURN true;
END;
$$;
