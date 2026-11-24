-- Fuller, text-grounded 'Did You Know?' facts, distinct from Instructor Insights.
create table if not exists public.scripture_did_you_know (
 reference text primary key, fact text not null, source_note text not null,
 created_at timestamptz not null default now()
);
alter table public.scripture_did_you_know enable row level security;
drop policy if exists "Public read Scripture Did You Know" on public.scripture_did_you_know;
create policy "Public read Scripture Did You Know" on public.scripture_did_you_know for select to anon, authenticated using (true);
revoke all on public.scripture_did_you_know from public,anon,authenticated;
grant select on public.scripture_did_you_know to anon,authenticated;
insert into public.scripture_did_you_know(reference,fact,source_note) values
('Genesis 2:10','Genesis describes one river leaving Eden and dividing into four named headwaters. The Tigris and Euphrates are real rivers, but that does not establish the precise location of Eden.','Genesis 2:10–14; geography of Mesopotamia. Textual detail and geographic identification must be distinguished.'),
('Genesis 3:7','The familiar picture of Adam and Eve covering themselves with a single fig leaf overlooks the plural: Genesis says they sewed fig leaves together to make coverings.','Genesis 3:7. Direct observation from the biblical text, not an archaeological claim.'),
('Genesis 4:21','Genesis names Jubal as an ancestor of those who play the lyre and pipe. It does not establish that he invented every form of string and wind instrument.','Genesis 4:21. The genealogy describes a cultural lineage.'),
('Genesis 6:16','The ark has a roof opening or window in Genesis 6:16, but the precise meaning of the Hebrew term tsohar is debated; translations render it differently.','Genesis 6:16; Hebrew צֹהַר (tsohar). Lexical ambiguity is documented, not hidden.'),
('Genesis 14:13','Abram is called ''the Hebrew'' in Genesis 14:13—the earliest occurrence of that designation for him in the biblical narrative.','Genesis 14:13. A textual first occurrence, not proof of independent historicity.'),
('Genesis 23:16','Abraham''s purchase of Sarah''s burial site is described with a weighed payment of 400 shekels of silver. Ancient transactions used weighed silver long before modern coins.','Genesis 23:16; historical context of weight-based silver payments.'),
('Genesis 41:14','Before Joseph appeared before Pharaoh, he shaved and changed clothes. This short detail fits the importance of grooming and court presentation in ancient Egypt.','Genesis 41:14; compare ancient Egyptian artistic depictions of court grooming. Contextual parallel, not independent proof of Joseph.'),
('Genesis 50:2','Genesis says Jacob was embalmed by physicians in Egypt. Egyptian embalming is independently known from archaeology, although that does not authenticate this individual burial.','Genesis 50:2–3; archaeological record of ancient Egyptian mummification.'),
('Exodus 32:15','The tablets of the covenant were written on both sides, not only on the front. Exodus states this twice in a single verse.','Exodus 32:15. Directly attested in the biblical text.'),
('Joshua 3:16','The Jordan crossing narrative names a town called Adam. The text places it near Zarethan, but identifying the ancient location precisely is a separate historical question.','Joshua 3:16. Biblical toponym, not a verified modern site identification.'),
('2 Kings 20:20','Hezekiah''s waterworks are associated with bringing water into Jerusalem. The Siloam Tunnel and its ancient inscription provide independent evidence of Iron Age water engineering there.','2 Kings 20:20; Siloam Tunnel inscription. Archaeology supports water infrastructure, not every detail of the narrative.'),
('Luke 2:1','Luke places Jesus'' birth in the reign of Augustus. Augustus is extensively documented by Roman inscriptions, coins, and historical sources; his existence is not disputed.','Luke 2:1; independently attested Roman emperor Augustus. This does not settle debates about the census chronology.'),
('John 19:20','John reports three inscription languages at Jesus'' crucifixion: Hebrew, Latin, and Greek. The languages reflect the multilingual Roman province described in the narrative.','John 19:20. A textual claim with a historically plausible linguistic setting.'),
('Acts 9:11','Acts gives the street name where Saul was to be found: Straight Street, in Damascus. A street axis known as Straight Street is part of the city''s historic urban layout.','Acts 9:11; Damascus urban history. The street''s history does not independently verify Saul''s visit.')
on conflict(reference) do update set fact=excluded.fact,source_note=excluded.source_note;

-- Prizes are never disclosed by the read-only discovery endpoint.
CREATE OR REPLACE FUNCTION public.get_quarterly_verse_quests(p_references text[])
 RETURNS TABLE(id uuid, reference text, question text, choices jsonb, prize_label text, attempted boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_quarter date:=date_trunc('quarter',now() at time zone 'Africa/Douala')::date;
begin
 if auth.uid() is null or p_references is null or cardinality(p_references)>180
 then return; end if;
 perform public.ensure_quarterly_verse_quests();
 return query
 select q.id,q.reference,q.question,q.choices,
 'A mystery gift'::text,
 exists(select 1 from public.quarterly_verse_quest_attempts a where a.quest_id=q.id and a.user_id=auth.uid())
 from public.quarterly_verse_quests q
 where q.quarter_start=v_quarter and q.winner_user_id is null
   and q.reference = any(p_references)
 order by q.reference;
end $function$;

-- New quarterly prize generation includes small rewards, starting at 50D.
CREATE OR REPLACE FUNCTION public.ensure_quarterly_verse_quests()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_quarter date := date_trunc('quarter', now() at time zone 'Africa/Douala')::date;
 v_count integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('fullcircle:verse-quest-quarter:'||v_quarter::text,0));
 select count(*) into v_count from public.quarterly_verse_quests where quarter_start=v_quarter;
 if v_count>0 then return v_count; end if;
 if (select count(*) from public.verse_quest_templates where enabled)<30 then return 0; end if;
 insert into public.quarterly_verse_quests (
   quarter_start,reference,question,choices,correct_answer,explanation,
   prize_type,prize_quantity,relic_slug
 )
 select v_quarter,reference,question,choices,correct_answer,explanation,
 case when rn<=3 then 'fcx_ticket' when rn<=15 then 'relic' else 'denarii' end,
 case when rn<=15 then 1 when rn%7=0 then 50 when rn%7=1 then 100 when rn%7=2 then 250 when rn%7=3 then 500 when rn%7=4 then 1000 when rn%7=5 then 1500 else 3000 end,
 case when rn between 4 and 15 then
   (array['shield-of-faith','boomerang','freeze-timer','skip','reveal-reference','sword-goliath'])[1+((rn-4)%6)]
 else null end
 from (
   with latest_reading as (
     select highlighted_verses from public.daily_narratives
     where narrative_date <= (now() at time zone 'Africa/Douala')::date
     order by narrative_date desc limit 1
   ),
   anchor as (
     select template.* from public.verse_quest_templates template
     join latest_reading latest on exists (
       select 1 from jsonb_array_elements(coalesce(latest.highlighted_verses,'[]'::jsonb)) verse
       where verse->>'reference'=template.reference
     )
     where template.enabled order by random() limit 1
   ),
   others as (
     select template.* from public.verse_quest_templates template
     where template.enabled and not exists (select 1 from anchor where anchor.reference=template.reference)
     order by random() limit (30-(select count(*) from anchor))
   ),
   candidates as (
     select true as is_anchor,anchor.* from anchor
     union all
     select false as is_anchor,others.* from others
   )
   select candidates.*, row_number() over(order by is_anchor desc,random()) rn from candidates
 ) picks;
 get diagnostics v_count=row_count;
 return v_count;
end $function$;

-- Rebalance unclaimed current-quarter Denarii rewards without altering claims
-- or the larger ticket/relic prize allocations.
with ranked as (
 select id,row_number() over(order by id) as rn
 from public.quarterly_verse_quests
 where quarter_start=date_trunc('quarter',now() at time zone 'Africa/Douala')::date
   and winner_user_id is null and prize_type='denarii'
)
update public.quarterly_verse_quests q
set prize_quantity=case when ranked.rn%7=0 then 50 when ranked.rn%7=1 then 100
 when ranked.rn%7=2 then 250 when ranked.rn%7=3 then 500 when ranked.rn%7=4 then 1000
 when ranked.rn%7=5 then 1500 else 3000 end
from ranked where q.id=ranked.id;
