CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('app.uid', true), '')::uuid $$;
    CREATE TABLE profiles (id uuid PRIMARY KEY, display_name text, avatar_url text);
    CREATE TABLE role_assignments (user_id uuid, role text, status text);
    CREATE TABLE tents (id uuid, sentry_id uuid, tent_house_id text);
    CREATE TABLE tent_members (tent_id uuid, user_id uuid, role text);
    CREATE TABLE arena_tournaments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text, created_by uuid, game_type text CHECK (game_type IN ('standard','ludo')),
      player_ids uuid[], has_group_stage boolean DEFAULT false, knockout_rounds int, status text DEFAULT 'scheduled',
      champion_id uuid, created_at timestamptz DEFAULT now(), completed_at timestamptz);
    CREATE TABLE arena_tournament_games (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid,
      round_number int, match_number int, planned_at timestamptz, group_number int, left_player_id uuid,
      right_player_id uuid, left_source_id uuid, right_source_id uuid, room_id uuid UNIQUE, winner_id uuid);
    CREATE TABLE arena_rooms (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), creator_id uuid, room_name text,
      stake_amount numeric, max_players int, status text, tagged_user_ids uuid[], game_call_fee numeric, expires_at timestamptz, winner_id uuid,
      play_mode text DEFAULT 'human', started_at timestamptz, completion_reason text, restarted_as_room_id uuid,
      narrative_date date, game_type text);
    CREATE TABLE arena_scheduled_matches (room_id uuid PRIMARY KEY, scheduled_by uuid, starts_at timestamptz, player_ids uuid[]);
    CREATE TABLE arena_participants (room_id uuid, user_id uuid, forfeited_at timestamptz, correct_count int DEFAULT 0, score int DEFAULT 0, joined_at timestamptz DEFAULT now(), stake_paid boolean, UNIQUE(room_id,user_id));
    CREATE TABLE arena_viewers (room_id uuid, user_id uuid, joined_at timestamptz, last_seen_at timestamptz, UNIQUE(room_id,user_id));
    CREATE TABLE arena_guest_witnesses (room_id uuid, guest_key_hash text, last_seen_at timestamptz, UNIQUE(room_id,guest_key_hash));
    CREATE TABLE denarii_ledger_entries (user_id uuid, amount numeric, source_type text, source_reference text, description text, UNIQUE(user_id,source_reference));
    CREATE TABLE test_notifications (user_id uuid, title text, payload jsonb);
    CREATE FUNCTION public.notify_user(uuid, uuid, text, text, text, text, jsonb) RETURNS void LANGUAGE sql AS $$
      INSERT INTO public.test_notifications VALUES ($1, $4, $7) $$;
ALTER TABLE arena_rooms ADD COLUMN completed_at timestamptz, ADD COLUMN machine_score int;
ALTER TABLE arena_participants ADD COLUMN finished_at timestamptz;
ALTER TABLE tents ADD COLUMN name text, ADD COLUMN created_at timestamptz;
CREATE TABLE arena_ludo_public_states (room_id uuid, public_state jsonb);
CREATE TABLE arena_trivia_responses (room_id uuid, user_id uuid, is_correct boolean);
CREATE TABLE arena_machine_trivia_responses (room_id uuid, is_correct boolean);
CREATE SCHEMA journey_private;
CREATE TABLE arena_journey_characters (slug text PRIMARY KEY, display_name text, ready boolean);
CREATE TABLE arena_journey_games (room_id uuid PRIMARY KEY, character_slug text NOT NULL REFERENCES arena_journey_characters(slug), state jsonb NOT NULL);
INSERT INTO arena_journey_characters VALUES ('elisha','Elisha',true), ('abraham','Abraham',false);
INSERT INTO profiles(id, display_name)
SELECT ('00000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid, 'Player ' || n
FROM generate_series(1,10) n;
INSERT INTO role_assignments SELECT id, CASE WHEN display_name='Player 1' THEN 'instructor' ELSE 'cadet' END, 'active' FROM profiles;
