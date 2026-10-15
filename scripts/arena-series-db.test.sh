#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/Users/bameelhakol/Documents/Codex/2026-07-23/los/supabase-plan-b/tools/pgsql/bin}"
TEMP_DIR="$(mktemp -d)"
PORT="${ARENA_TEST_PG_PORT:-55439}"
cleanup() {
  "$PG_BIN/pg_ctl" -D "$TEMP_DIR/data" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

LC_ALL=C "$PG_BIN/initdb" -D "$TEMP_DIR/data" -A trust --no-instructions \
  -c shared_memory_type=mmap -c dynamic_shared_memory_type=mmap >/dev/null
"$PG_BIN/pg_ctl" -D "$TEMP_DIR/data" \
  -o "-k $TEMP_DIR -p $PORT -F -c listen_addresses=''" -w start >/dev/null
export PGHOST="$TEMP_DIR" PGPORT="$PORT" PGUSER="$(id -un)" PGDATABASE=postgres

"$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('test.uid', true), '')::uuid;
$$;
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY, display_name text, avatar_url text
);
CREATE TABLE public.arena_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid REFERENCES public.profiles(id),
  room_name text NOT NULL,
  stake_amount integer NOT NULL DEFAULT 0,
  max_players integer NOT NULL DEFAULT 2,
  status text NOT NULL DEFAULT 'waiting',
  tagged_user_ids uuid[] NOT NULL DEFAULT '{}',
  game_call_fee integer NOT NULL DEFAULT 0,
  narrative_date text,
  game_type text,
  play_mode text NOT NULL DEFAULT 'versus',
  completion_reason text,
  winner_id uuid,
  restarted_as_room_id uuid,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  machine_score integer
);
CREATE TABLE public.arena_participants (
  room_id uuid REFERENCES public.arena_rooms(id),
  user_id uuid REFERENCES public.profiles(id),
  stake_paid boolean DEFAULT false,
  score integer DEFAULT 0,
  correct_count integer DEFAULT 0,
  finished_at timestamptz,
  forfeited_at timestamptz,
  joined_at timestamptz DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);
CREATE TABLE public.arena_scheduled_matches (
  room_id uuid PRIMARY KEY REFERENCES public.arena_rooms(id),
  scheduled_by uuid REFERENCES public.profiles(id),
  starts_at timestamptz,
  player_ids uuid[]
);
CREATE TABLE public.arena_tournament_games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), room_id uuid UNIQUE
);
CREATE TABLE public.arena_viewers (
  room_id uuid REFERENCES public.arena_rooms(id), user_id uuid REFERENCES public.profiles(id),
  joined_at timestamptz DEFAULT now(), last_seen_at timestamptz DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);
CREATE TABLE public.arena_guest_witnesses (
  room_id uuid REFERENCES public.arena_rooms(id), guest_key_hash text,
  last_seen_at timestamptz DEFAULT now(), PRIMARY KEY (room_id, guest_key_hash)
);
CREATE TABLE public.arena_question_decks (room_id uuid, questions jsonb);
CREATE TABLE public.arena_trivia_responses (
  room_id uuid, user_id uuid, figs_earned integer, is_correct boolean
);
CREATE TABLE public.arena_machine_trivia_responses (
  room_id uuid, figs_earned integer, is_correct boolean
);
CREATE TABLE public.denarii_ledger_entries (
  user_id uuid, amount integer, source_type text, source_reference text, description text
);
CREATE TABLE public.arena_ludo_public_states (room_id uuid, public_state jsonb);
CREATE TABLE public.tents (
  id uuid, name text, tent_house_id text, sentry_id uuid, created_at timestamptz
);
CREATE TABLE public.tent_members (tent_id uuid, user_id uuid);
CREATE FUNCTION public.notify_user(uuid, uuid, text, text, text, text, jsonb)
RETURNS uuid LANGUAGE sql AS $$ SELECT gen_random_uuid(); $$;

INSERT INTO public.profiles(id, display_name)
SELECT ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'Player ' || n
FROM generate_series(1, 5) n;
INSERT INTO public.arena_rooms(id, creator_id, room_name, max_players, status, started_at)
VALUES ('00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000005', 'Already live [arena:standard]', 2, 'playing', now());
INSERT INTO public.arena_scheduled_matches(room_id, scheduled_by, starts_at, player_ids)
VALUES ('00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000005', now(),
  ARRAY['00000000-0000-0000-0000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid]);
SQL

"$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -q \
  -f "$ROOT/supabase/migrations/20261015150000_arena_scorecard_winner.sql" \
  -f "$ROOT/supabase/migrations/20261015151000_arena_scheduled_match_series.sql"

"$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -q <<'SQL'
DO $$
DECLARE
  a uuid := '00000000-0000-0000-0000-000000000001';
  b uuid := '00000000-0000-0000-0000-000000000002';
  c uuid := '00000000-0000-0000-0000-000000000003';
  d uuid := '00000000-0000-0000-0000-000000000004';
  host uuid := '00000000-0000-0000-0000-000000000005';
  first_room uuid;
  second_room uuid;
  third_room uuid;
  four_room uuid;
  next_room uuid;
  series_id uuid;
  v_result jsonb;
  leg integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.arena_match_series
    WHERE initial_room_id = '00000000-0000-0000-0000-000000000101') THEN
    RAISE EXCEPTION 'An already playing match was changed by the backfill';
  END IF;
  INSERT INTO public.arena_rooms(creator_id, room_name, max_players)
  VALUES (a, 'Final [arena:standard]', 2) RETURNING id INTO first_room;
  INSERT INTO public.arena_scheduled_matches(room_id, scheduled_by, starts_at, player_ids)
  VALUES (first_room, host, now(), ARRAY[a, b]);
  SELECT id INTO series_id FROM public.arena_match_series WHERE initial_room_id = first_room;
  IF series_id IS NULL THEN RAISE EXCEPTION 'Series was not registered'; END IF;
  INSERT INTO public.arena_tournament_games(room_id) VALUES (first_room);
  INSERT INTO public.arena_participants(room_id, user_id) VALUES (first_room, a), (first_room, b);
  UPDATE public.arena_rooms SET status = 'playing', started_at = now() WHERE id = first_room;
  UPDATE public.arena_participants SET correct_count = CASE WHEN user_id = a THEN 5 ELSE 4 END,
    score = CASE WHEN user_id = a THEN 10 ELSE 8 END WHERE room_id = first_room;
  UPDATE public.arena_rooms SET status = 'completed', winner_id = a,
    completion_reason = 'finished', completed_at = now() WHERE id = first_room;
  SELECT restarted_as_room_id INTO second_room FROM public.arena_rooms WHERE id = first_room;
  IF second_room IS NULL OR (SELECT winner_id FROM public.arena_rooms WHERE id = first_room) IS NOT NULL
    THEN RAISE EXCEPTION 'First leg finalized instead of advancing'; END IF;
  IF (SELECT room_id FROM public.arena_tournament_games) <> second_room
    THEN RAISE EXCEPTION 'Tournament fixture did not follow the second leg'; END IF;
  IF (SELECT count(*) FROM public.arena_participants WHERE room_id = second_room) <> 2
    THEN RAISE EXCEPTION 'Players did not join the next leg'; END IF;
  UPDATE public.arena_participants SET correct_count = CASE WHEN user_id = a THEN 3 ELSE 4 END,
    score = CASE WHEN user_id = a THEN 6 ELSE 8 END WHERE room_id = second_room;
  UPDATE public.arena_rooms SET status = 'completed', winner_id = b,
    completion_reason = 'finished', completed_at = now() WHERE id = second_room;
  SELECT restarted_as_room_id INTO third_room FROM public.arena_rooms WHERE id = second_room;
  IF third_room IS NULL OR (SELECT completion_reason FROM public.arena_rooms WHERE id = second_room) <> 'draw'
    THEN RAISE EXCEPTION 'Aggregate tie did not create an automatic rematch'; END IF;
  IF public.get_public_arena_successor(first_room) <> third_room
    THEN RAISE EXCEPTION 'Public witness link did not follow the rematch'; END IF;
  UPDATE public.arena_participants SET correct_count = CASE WHEN user_id = a THEN 2 ELSE 1 END,
    score = CASE WHEN user_id = a THEN 4 ELSE 2 END WHERE room_id = third_room;
  UPDATE public.arena_rooms SET status = 'completed', winner_id = a,
    completion_reason = 'finished', completed_at = now() WHERE id = third_room;
  IF (SELECT winner_id FROM public.arena_match_series WHERE id = series_id) <> a
    THEN RAISE EXCEPTION 'Rematch did not produce the aggregate winner'; END IF;
  IF (SELECT correct_count FROM public.arena_participants WHERE room_id = third_room AND user_id = a) <> 10
    THEN RAISE EXCEPTION 'Final score did not include all legs'; END IF;
  v_result := public.get_public_arena_final_scorecard(third_room);
  IF v_result ->> 'winner_id' <> a::text THEN
    RAISE EXCEPTION 'Public scorecard did not show the winner'; END IF;

  INSERT INTO public.arena_rooms(creator_id, room_name, max_players)
  VALUES (a, 'Four Players [arena:ludo]', 4) RETURNING id INTO four_room;
  INSERT INTO public.arena_scheduled_matches(room_id, scheduled_by, starts_at, player_ids)
  VALUES (four_room, host, now(), ARRAY[a, b, c, d]);
  INSERT INTO public.arena_participants(room_id, user_id)
  VALUES (four_room, a), (four_room, b), (four_room, c), (four_room, d);
  UPDATE public.arena_rooms SET status = 'playing', started_at = now() WHERE id = four_room;
  IF (SELECT required_rounds FROM public.arena_match_series WHERE initial_room_id = four_room) <> 3
    THEN RAISE EXCEPTION 'Four players should have three legs'; END IF;
  FOR leg IN 1..2 LOOP
    UPDATE public.arena_participants SET correct_count = CASE WHEN user_id = a THEN 4 ELSE 1 END,
      score = CASE WHEN user_id = a THEN 8 ELSE 2 END WHERE room_id = four_room;
    UPDATE public.arena_rooms SET status = 'completed', winner_id = a,
      completion_reason = 'finished', completed_at = now() WHERE id = four_room
    RETURNING restarted_as_room_id INTO next_room;
    four_room := next_room;
  END LOOP;
  UPDATE public.arena_participants SET correct_count = CASE WHEN user_id = a THEN 4 ELSE 1 END,
    score = CASE WHEN user_id = a THEN 8 ELSE 2 END WHERE room_id = four_room;
  UPDATE public.arena_rooms SET status = 'completed', winner_id = a,
    completion_reason = 'finished', completed_at = now() WHERE id = four_room;
  IF (SELECT correct_count FROM public.arena_participants WHERE room_id = four_room AND user_id = a) <> 12
    THEN RAISE EXCEPTION 'Three-leg total was not retained'; END IF;
END;
$$;
SQL

echo 'Arena series database checks passed.'
