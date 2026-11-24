\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';
SELECT pg_advisory_xact_lock(214214);
SELECT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
  WHERE version = '20261026111736') AS installed \gset
\if :installed
  \echo Two-to-four-player matches are already installed.
\else
  \ir ../supabase/migrations/20261026111736_arena_match_two_to_four_players.sql
  INSERT INTO supabase_migrations.schema_migrations(version,name)
  VALUES ('20261026111736','arena_match_two_to_four_players');
\endif
DO $$
BEGIN
  IF to_regprocedure('public.create_instructor_arena_tournament_lineups(text,text,uuid[],timestamptz[],boolean,jsonb,integer)') IS NULL
    OR has_function_privilege('anon','public.set_arena_tournament_game_players(uuid,jsonb)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.set_arena_tournament_game_players(uuid,jsonb)','EXECUTE')
    OR has_function_privilege('anon','public.create_instructor_arena_tournament_lineups(text,text,uuid[],timestamptz[],boolean,jsonb,integer)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.create_instructor_arena_tournament_lineups(text,text,uuid[],timestamptz[],boolean,jsonb,integer)','EXECUTE')
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='arena_tournament_games' AND column_name='fourth_player_id') THEN
    RAISE EXCEPTION 'Two-to-four-player matches are not ready.';
  END IF;
END;
$$;
\if :rehearse
  ROLLBACK;
  \echo Match-capacity rehearsal rolled back.
\else
  COMMIT;
  \echo Two-to-four-player matches installed.
\endif
