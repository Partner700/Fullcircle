-- Stale Arena revisions are application conflicts, not retryable serialization failures.
-- Keep function bodies, ownership and execute privileges unchanged except for SQLSTATE.
DO $migration$
DECLARE
  target record;
  original text;
  patched text;
BEGIN
  FOR target IN
    SELECT oid FROM pg_proc
    WHERE oid IN (
      'public.commit_arena_ludo_turn(uuid,integer,jsonb,jsonb,uuid,uuid,text)'::regprocedure,
      'public.commit_arena_journey_command(uuid,integer,jsonb,uuid,uuid)'::regprocedure,
      'public.commit_machine_arena_journey_command(uuid,integer,jsonb,uuid,uuid)'::regprocedure
    )
  LOOP
    original := pg_get_functiondef(target.oid);
    patched := replace(original, 'ERRCODE = ''40001''', 'ERRCODE = ''PT409''');
    IF patched <> original THEN EXECUTE patched; END IF;
    IF position('40001' in (SELECT prosrc FROM pg_proc WHERE oid=target.oid)) > 0 THEN
      RAISE EXCEPTION 'Arena conflict error replacement failed';
    END IF;
  END LOOP;
END
$migration$;
