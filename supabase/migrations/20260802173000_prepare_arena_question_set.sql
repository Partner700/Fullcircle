create or replace function public.prepare_arena_question_set(
  p_room_id uuid,
  p_user_id uuid,
  p_questions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_questions jsonb;
begin
  if auth.uid() is distinct from p_user_id then
    raise exception 'You can only prepare questions for your own Arena match.';
  end if;

  if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) = 0 then
    raise exception 'The Arena question deck cannot be empty.';
  end if;

  if not exists (
    select 1 from public.arena_participants
    where room_id = p_room_id and user_id = p_user_id and forfeited_at is null
  ) then
    raise exception 'You are not an active participant in this Arena match.';
  end if;

  update public.arena_rooms
  set question_set = p_questions,
      question_generated_at = now(),
      machine_score = case
        when play_mode = 'machine' and room_name ilike '%[difficulty:easy]%' then 7
        when play_mode = 'machine' and room_name ilike '%[difficulty:hard]%' then 17
        when play_mode = 'machine' then 12
        else machine_score
      end
  where id = p_room_id
    and status in ('waiting', 'playing')
    and (question_set is null or jsonb_array_length(question_set) = 0);

  select question_set into v_questions
  from public.arena_rooms
  where id = p_room_id;

  if v_questions is null or jsonb_array_length(v_questions) = 0 then
    raise exception 'The Arena could not store its question deck.';
  end if;

  return v_questions;
end;
$$;

grant execute on function public.prepare_arena_question_set(uuid, uuid, jsonb) to authenticated;
