-- Birthday conversations are separate from quote scores and birthday dates repeat yearly.
CREATE TABLE public.birthday_reactions (
  celebration_id uuid NOT NULL,
  celebration_date date NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reaction_type text NOT NULL CHECK (reaction_type IN ('amen','spark','thoughtful')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(celebration_id,celebration_date,user_id,reaction_type)
);
CREATE TABLE public.birthday_wishes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  celebration_id uuid NOT NULL,
  celebration_date date NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 500),
  parent_id uuid REFERENCES public.birthday_wishes(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz
);
CREATE INDEX birthday_wishes_conversation ON public.birthday_wishes(celebration_id,celebration_date,created_at);
ALTER TABLE public.birthday_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.birthday_wishes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.birthday_reactions,public.birthday_wishes FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.require_visible_birthday(p_id uuid,p_date date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private AS $$
DECLARE v_metadata jsonb; v_recipient uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to join birthday celebrations.'; END IF;
  SELECT metadata INTO v_metadata FROM public.get_today_birthday_announcements()
    WHERE id=p_id AND timezone('Africa/Douala',publish_at)::date=p_date LIMIT 1;
  IF NOT FOUND THEN
    SELECT announcement.metadata INTO v_metadata FROM public.scheduled_announcements announcement
      WHERE announcement.id=p_id AND announcement.announcement_type='birthday'
        AND announcement.is_active AND announcement.publish_at<=now()
        AND (announcement.expires_at IS NULL OR announcement.expires_at>now())
        AND timezone('Africa/Douala',announcement.publish_at)::date=p_date
        AND (announcement.audience='all' OR EXISTS (
          SELECT 1 FROM public.role_assignments role WHERE role.user_id=auth.uid()
            AND role.status IN ('active','approved') AND (role.end_date IS NULL OR role.end_date>=current_date)
            AND announcement.audience=CASE role.role::text WHEN 'sentry' THEN 'sentries' ELSE role.role::text||'s' END
        ));
    IF NOT FOUND THEN RAISE EXCEPTION 'This birthday celebration is not available.'; END IF;
  END IF;
  SELECT id INTO v_recipient FROM public.profiles WHERE id::text=v_metadata->>'user_id';
  RETURN v_recipient;
END;
$$;
REVOKE ALL ON FUNCTION private.require_visible_birthday(uuid,date) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_birthday_conversation(p_celebration_id uuid,p_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private AS $$
DECLARE v_reactions jsonb; v_wishes jsonb;
BEGIN
  PERFORM private.require_visible_birthday(p_celebration_id,p_date);
  SELECT coalesce(jsonb_object_agg(reaction_type,state),'{}'::jsonb) INTO v_reactions FROM (
    SELECT reaction_type,jsonb_build_object(
      'count',count(*),'reacted',bool_or(user_id=auth.uid()),
      'actors',(
        SELECT coalesce(jsonb_agg(actor),'[]'::jsonb) FROM (
          SELECT profile.id AS user_id,profile.display_name,profile.avatar_url
          FROM public.birthday_reactions recent JOIN public.profiles profile ON profile.id=recent.user_id
          WHERE recent.celebration_id=p_celebration_id AND recent.celebration_date=p_date
            AND recent.reaction_type=reaction.reaction_type
          ORDER BY recent.created_at DESC,profile.id LIMIT 5
        ) actor
      )
    ) AS state FROM public.birthday_reactions reaction
    WHERE celebration_id=p_celebration_id AND celebration_date=p_date GROUP BY reaction_type
  ) grouped;
  SELECT coalesce(jsonb_agg(item ORDER BY created_at,id),'[]'::jsonb) INTO v_wishes FROM (
    SELECT wish.id,wish.body,wish.created_at,wish.edited_at,wish.user_id AS commenter_user_id,
      wish.parent_id AS parent_comment_id,profile.display_name,profile.avatar_url,'Member'::text AS rank_label
    FROM public.birthday_wishes wish JOIN public.profiles profile ON profile.id=wish.user_id
    WHERE wish.celebration_id=p_celebration_id AND wish.celebration_date=p_date
  ) item;
  RETURN jsonb_build_object('reactions',v_reactions,'comments',v_wishes);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_birthday_reaction(p_celebration_id uuid,p_date date,p_reaction_type text,p_reacted boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private AS $$
BEGIN
  PERFORM private.require_visible_birthday(p_celebration_id,p_date);
  IF p_reaction_type NOT IN ('amen','spark','thoughtful') OR p_reaction_type IS NULL OR p_reacted IS NULL THEN RAISE EXCEPTION 'Choose a valid reaction.'; END IF;
  IF p_reacted THEN
    INSERT INTO public.birthday_reactions(celebration_id,celebration_date,user_id,reaction_type)
    VALUES(p_celebration_id,p_date,auth.uid(),p_reaction_type) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.birthday_reactions WHERE celebration_id=p_celebration_id AND celebration_date=p_date
      AND user_id=auth.uid() AND reaction_type=p_reaction_type;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_birthday_wish(p_celebration_id uuid,p_date date,p_body text,p_id uuid DEFAULT NULL,p_parent_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private AS $$
DECLARE v_recipient uuid; v_wish uuid; v_name text;
BEGIN
  v_recipient:=private.require_visible_birthday(p_celebration_id,p_date);
  IF p_body IS NULL OR length(btrim(p_body)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Write a birthday wish of 1 to 500 characters.'; END IF;
  IF p_id IS NOT NULL THEN
    UPDATE public.birthday_wishes SET body=btrim(p_body),edited_at=now()
      WHERE id=p_id AND celebration_id=p_celebration_id AND celebration_date=p_date AND user_id=auth.uid()
      RETURNING id INTO v_wish;
    IF NOT FOUND THEN RAISE EXCEPTION 'Only the author can edit this wish.'; END IF;
  ELSE
    IF p_parent_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.birthday_wishes WHERE id=p_parent_id AND celebration_id=p_celebration_id
        AND celebration_date=p_date AND parent_id IS NULL
    ) THEN RAISE EXCEPTION 'Choose a wish from this birthday celebration.'; END IF;
    INSERT INTO public.birthday_wishes(celebration_id,celebration_date,user_id,body,parent_id)
      VALUES(p_celebration_id,p_date,auth.uid(),btrim(p_body),p_parent_id) RETURNING id INTO v_wish;
    IF v_recipient IS NOT NULL AND v_recipient<>auth.uid() THEN
      SELECT display_name INTO v_name FROM public.profiles WHERE id=auth.uid();
      PERFORM public.notify_user(v_recipient,auth.uid(),'birthday','A birthday wish for you',
        coalesce(v_name,'A camp member')||': '||left(btrim(p_body),180),'dashboard',
        jsonb_build_object('celebration_id',p_celebration_id,'wish_id',v_wish,'celebration_date',p_date));
    END IF;
  END IF;
  RETURN v_wish;
END;
$$;
REVOKE ALL ON FUNCTION public.get_birthday_conversation(uuid,date),
  public.set_birthday_reaction(uuid,date,text,boolean),public.save_birthday_wish(uuid,date,text,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_birthday_conversation(uuid,date),
  public.set_birthday_reaction(uuid,date,text,boolean),public.save_birthday_wish(uuid,date,text,uuid,uuid) TO authenticated;
