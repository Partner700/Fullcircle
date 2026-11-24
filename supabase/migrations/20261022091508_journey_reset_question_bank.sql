-- Requested one-time hard reset of the Journey bank only. Never cascade into match results.
LOCK TABLE public.arena_rooms, public.arena_journey_games, public.arena_journey_characters,
  public.arena_journey_questions IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.arena_journey_games g JOIN public.arena_rooms r ON r.id = g.room_id
    WHERE r.status = 'playing') THEN
    RAISE EXCEPTION 'A Journey match is still playing. Finish it before resetting the question bank.';
  END IF;
END;
$$;
UPDATE public.arena_journey_characters SET ready = false, updated_at = now();
UPDATE public.arena_journey_games SET current_question_id = NULL WHERE current_question_id IS NOT NULL;
DELETE FROM public.arena_journey_questions;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.arena_journey_questions)
    OR EXISTS (SELECT 1 FROM public.arena_journey_characters WHERE ready) THEN
    RAISE EXCEPTION 'The Journey bank reset did not complete.';
  END IF;
END;
$$;
